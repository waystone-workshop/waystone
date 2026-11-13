import { createNoiseProcessor } from "./noise-processor.mjs";
import { voiceCaptureFor, readAudioPreferences, writeAudioPreferences } from "./audio-quality.mjs";
import { readVideoPreferences, writeVideoPreferences } from "./video-quality.mjs";
import { readSoundPreferences, writeSoundPreferences } from "./sounds.mjs";

export function matchingSettings(items, query) {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => !needle || `${item.label} ${item.group} ${item.keywords}`.toLowerCase().includes(needle));
}

export function setupSettings({ document, bridge, report, openProfile, user, avatar, storage, onVideoChange, onAudioChange, permit, onExpressions }) {
  const $ = (id) => document.getElementById(id);
  const links = [...document.querySelectorAll("[data-settings-page]")];
  const panels = [...document.querySelectorAll("[data-settings-panel]")];
  const groups = [...document.querySelectorAll("p[data-settings-group]")];
  let page = "account";

  function show(next) {
    if (next !== "audio") stopMicTest();
    page = next;
    for (const panel of panels) panel.hidden = panel.dataset.settingsPanel !== next;
    for (const link of links) link.classList.toggle("active", link.dataset.settingsPage === next && !link.hidden);
    if (next === "audio") { loadAudio(); loadVideo(); }
    if (next === "account") renderAccount();
    if (next === "server") onExpressions?.();
    if (next === "system") loadSounds();
  }

  function permitted(link) {
    const required = link.dataset.settingsRole;
    if (required === "expressions") return permit ? permit() : user()?.role === "admin";
    return !required || user()?.role === required;
  }

  function filter() {
    const query = $("settings-search").value;
    const visible = new Set(matchingSettings(links.map((link) => ({
      id: link.dataset.settingsPage,
      label: link.textContent,
      group: link.dataset.settingsGroup,
      keywords: link.dataset.settingsKeywords || "",
    })), query).map((item) => item.id));
    for (const link of links) link.hidden = !visible.has(link.dataset.settingsPage) || !permitted(link);
    for (const group of groups) {
      group.hidden = !links.some((link) => link.dataset.settingsGroup === group.dataset.settingsGroup && !link.hidden);
    }
    $("settings-empty").hidden = visible.size > 0;
    if (!visible.has(page)) {
      const first = links.find((link) => !link.hidden);
      if (first) show(first.dataset.settingsPage);
    } else show(page);
  }

  function renderAccount() {
    const person = user() || {};
    $("settings-name").textContent = person.display_name || "Your account";
    $("settings-username").textContent = person.username ? `@${person.username}` : "";
    $("settings-display").textContent = person.display_name || "Not signed in";
    $("settings-role").textContent = person.role || "";
    const portrait = $("settings-avatar");
    portrait.replaceChildren(person.display_name ? avatar(person) : document.createElement("span"));
  }

  function loadAudio() {
    const preferences = readAudioPreferences(storage);
    $("audio-noise").value = preferences.noiseSuppression ? "automatic" : "off";
    $("audio-echo").checked = preferences.echoCancellation;
    $("audio-gain").checked = preferences.autoGainControl;
    renderSensitivity(preferences);
    return refreshMicrophones(preferences.deviceId);
  }

  async function refreshMicrophones(selected) {
    const menu = $("audio-device");
    const current = selected ?? readAudioPreferences(storage).deviceId;
    const devices = document.defaultView.navigator.mediaDevices?.enumerateDevices
      ? await document.defaultView.navigator.mediaDevices.enumerateDevices().catch(() => [])
      : [];
    const microphones = devices.filter((device) => device.kind === "audioinput" && device.deviceId);
    const option = (label, value) => {
      const element = document.createElement("option");
      element.value = value;
      element.textContent = label;
      return element;
    };
    menu.replaceChildren(option("Default microphone", ""));
    microphones.forEach((device, index) => menu.append(option(device.label || `Microphone ${index + 1}`, device.deviceId)));
    menu.value = [...menu.options].some((option) => option.value === current) ? current : "";
  }

  function loadVideo() {
    if (!$("video-quality")) return;
    const video = readVideoPreferences(storage);
    $("video-quality").value = video.quality;
    $("video-fps").value = String(video.frameRate);
  }

  function renderSensitivity(preferences) {
    if (!$('audio-input-mode')) return;
    $('audio-input-mode').value = preferences.inputMode;
    $('audio-threshold').value = preferences.inputThreshold;
    $('audio-threshold-value').textContent = preferences.inputThreshold + ' dB';
    $('audio-threshold-row').hidden = preferences.inputMode !== 'manual';
  }
  function saveAudio(patch) {
    const preferences = writeAudioPreferences(patch, storage);
    renderSensitivity(preferences);
    if (micProcessor && Object.keys(patch).every(key => ['inputMode', 'inputThreshold'].includes(key))) micProcessor.configure(preferences);
    else if (micStream || micStarting) stopMicTest();
    Promise.resolve(onAudioChange?.(patch)).catch(report);
  }
  let micVersion = 0, micStream, micProcessor, micStarting = false;
  function stopMicTest() {
    micVersion++; micStarting = false;
    micStream?.getTracks().forEach(track => track.stop()); micStream = undefined;
    const old = micProcessor; micProcessor = undefined;
    old?.destroy().catch(report);
    if ($('audio-test')) {
      $('audio-test').textContent = 'Test microphone'; $('audio-level').value = -70;
      $('audio-test-state').textContent = 'Microphone test is off'; $('audio-test-level').textContent = '';
    }
  }
  async function startMicTest() {
    if (micStream || micStarting) { stopMicTest(); return; }
    const current = ++micVersion;
    micStarting = true; $('audio-test').textContent = 'Stop test';
    $('audio-test-state').textContent = 'Waiting for microphone…';
    let stream, processor;
    try {
      const preferences = readAudioPreferences(storage);
      stream = await document.defaultView.navigator.mediaDevices.getUserMedia({ audio: voiceCaptureFor(preferences), video: false });
      if (current !== micVersion) { stream.getTracks().forEach(track => track.stop()); return; }
      const track = stream.getAudioTracks()[0];
      const denoise = preferences.noiseSuppression && !track.getSettings().voiceIsolation;
      if (denoise) await track.applyConstraints({ noiseSuppression: false });
      processor = createNoiseProcessor({ ...preferences, noiseSuppression: denoise }, state => {
        if (current !== micVersion) return;
        $('audio-level').value = Math.max(-70, state.db);
        const label = state.open ? 'Voice detected · mic open' : 'Below threshold · mic quiet';
        if ($('audio-test-state').textContent !== label) $('audio-test-state').textContent = label;
        $('audio-test-level').textContent = Math.round(state.db) + ' dB · opens at ' + Math.round(state.threshold) + ' dB';
      });
      await processor.init({ track });
      if (current !== micVersion) { stream.getTracks().forEach(track => track.stop()); await processor.destroy(); return; }
      micStream = stream; micProcessor = processor; micStarting = false;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      await processor?.destroy();
      if (current !== micVersion) return;
      stopMicTest(); $('audio-test-state').textContent = 'Could not test microphone. Check input and permission.';
      report(error);
    }
  }
  $('audio-test')?.addEventListener('click', startMicTest);
  $('audio-input-mode')?.addEventListener('change', () => saveAudio({ inputMode: $('audio-input-mode').value }));
  $('audio-threshold')?.addEventListener('input', () => {
    $('audio-threshold-value').textContent = $('audio-threshold').value + ' dB';
    micProcessor?.configure({ inputThreshold: Number($('audio-threshold').value) });
  });
  $('audio-threshold')?.addEventListener('change', () => saveAudio({ inputThreshold: Number($('audio-threshold').value) }));
  $('settings-dialog').addEventListener('close', stopMicTest);
  document.defaultView.addEventListener('pagehide', stopMicTest);


  function loadSounds() {
    const input = $("sound-notifications");
    if (!input) return;
    input.checked = readSoundPreferences(storage).enabled;
  }

  async function loadDesktop() {
    const settings = bridge.desktopSettings
      ? await bridge.desktopSettings()
      : { closeToTray: true, openAtLogin: false, packaged: false };
    $("close-to-tray").checked = settings.closeToTray !== false;
    $("open-at-login").checked = settings.openAtLogin === true;
    $("startup-note").hidden = settings.packaged !== false;
  }

  async function saveDesktop(patch) {
    if (!bridge.saveDesktopSettings) return;
    try {
      const saved = await bridge.saveDesktopSettings(patch);
      $("close-to-tray").checked = saved.closeToTray;
      $("open-at-login").checked = saved.openAtLogin;
    } catch (error) { report(error); }
  }

  $("settings-search").addEventListener("input", filter);
  for (const link of links) link.addEventListener("click", () => show(link.dataset.settingsPage));
  for (const button of document.querySelectorAll("[data-edit-profile]")) button.addEventListener("click", () => openProfile());
  $("audio-noise").addEventListener("change", () => saveAudio({ noiseSuppression: $("audio-noise").value !== "off" }));
  $("audio-echo").addEventListener("change", () => saveAudio({ echoCancellation: $("audio-echo").checked }));
  $("audio-gain").addEventListener("change", () => saveAudio({ autoGainControl: $("audio-gain").checked }));
  $("audio-device").addEventListener("change", () => saveAudio({ deviceId: $("audio-device").value }));
  $("video-quality")?.addEventListener("change", () => {
    writeVideoPreferences({ quality: $("video-quality").value }, storage);
    onVideoChange?.();
  });
  $("video-fps")?.addEventListener("change", () => {
    writeVideoPreferences({ frameRate: Number($("video-fps").value) }, storage);
    onVideoChange?.();
  });
  $("sound-notifications")?.addEventListener("change", () => {
    writeSoundPreferences({ enabled: $("sound-notifications").checked }, storage);
  });
  $("close-to-tray").addEventListener("change", () => saveDesktop({ closeToTray: $("close-to-tray").checked }));
  $("open-at-login").addEventListener("change", () => saveDesktop({ openAtLogin: $("open-at-login").checked }));

  return {
    open() {
      $("settings-search").value = "";
      filter();
      show("account");
      renderAccount();
      loadDesktop().catch(report);
    },
    refresh() {
      filter();
    },
  };
}
