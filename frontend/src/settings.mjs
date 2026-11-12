import { readAudioPreferences, writeAudioPreferences } from "./audio-quality.mjs";
import { readVideoPreferences, writeVideoPreferences } from "./video-quality.mjs";

export function matchingSettings(items, query) {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => !needle || `${item.label} ${item.group} ${item.keywords}`.toLowerCase().includes(needle));
}

export function setupSettings({ document, bridge, report, openProfile, user, avatar, storage, onVideoChange, permit, onExpressions }) {
  const $ = (id) => document.getElementById(id);
  const links = [...document.querySelectorAll("[data-settings-page]")];
  const panels = [...document.querySelectorAll("[data-settings-panel]")];
  const groups = [...document.querySelectorAll("p[data-settings-group]")];
  let page = "account";

  function show(next) {
    page = next;
    for (const panel of panels) panel.hidden = panel.dataset.settingsPanel !== next;
    for (const link of links) link.classList.toggle("active", link.dataset.settingsPage === next && !link.hidden);
    if (next === "audio") { loadAudio(); loadVideo(); }
    if (next === "account") renderAccount();
    if (next === "server") onExpressions?.();
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

  function saveAudio(patch) {
    writeAudioPreferences(patch, storage);
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
