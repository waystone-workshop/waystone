import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { matchingSettings, setupSettings } from "../src/settings.mjs";
import { readAudioPreferences } from "../src/audio-quality.mjs";
import { readVideoPreferences } from "../src/video-quality.mjs";

test("search matches a section label, group, or keyword", () => {
  const items = [
    { id: "account", label: "Account", group: "user", keywords: "profile" },
    { id: "security", label: "Password & security", group: "user", keywords: "password" },
    { id: "system", label: "System", group: "system", keywords: "close tray startup" },
  ];
  assert.deepEqual(matchingSettings(items, "tray").map((item) => item.id), ["system"]);
  assert.deepEqual(matchingSettings(items, "password").map((item) => item.id), ["security"]);
  assert.equal(matchingSettings(items, "").length, 3);
});

test("settings pages, search, and switches stay on the choices the listener made", async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <dialog id="settings-dialog">
      <input id="settings-search" />
      <p id="settings-empty" hidden></p>
      <p data-settings-group="user">User settings</p>
      <button class="settings-link" data-settings-page="account" data-settings-group="user" data-settings-keywords="profile">Account</button>
      <button class="settings-link" data-settings-page="security" data-settings-group="user" data-settings-keywords="password">Password &amp; security</button>
      <p data-settings-group="audio">Audio settings</p>
      <button class="settings-link" data-settings-page="audio" data-settings-group="audio" data-settings-keywords="voice microphone">Voice</button>
      <p data-settings-group="system">System</p>
      <button class="settings-link" data-settings-page="system" data-settings-group="system" data-settings-keywords="close tray startup">System</button>
      <section data-settings-panel="account"></section>
      <section data-settings-panel="security" hidden></section>
      <section data-settings-panel="audio" hidden>
        <select id="audio-noise"><option value="automatic">Automatic</option><option value="off">Off</option></select><input id="audio-echo" type="checkbox" /><input id="audio-gain" type="checkbox" /><select id="audio-device"></select>
        <select id="video-quality"><option value="720">720</option><option value="1080">1080</option><option value="hq">HQ</option></select>
        <select id="video-fps"><option value="15">15</option><option value="30">30</option><option value="60">60</option></select>
      </section>
      <section data-settings-panel="system" hidden>
        <input id="close-to-tray" type="checkbox" /><input id="open-at-login" type="checkbox" /><p id="startup-note" hidden></p>
      </section>
      <span id="settings-avatar"></span><strong id="settings-name"></strong><p id="settings-username"></p><p id="settings-display"></p><p id="settings-role"></p>
      <button data-edit-profile></button>
    </dialog></body>`);
  const document = dom.window.document;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let saved;
  const settings = setupSettings({
    document, storage, report() {}, openProfile() {},
    user: () => ({ display_name: "Ada", username: "ada", role: "admin" }),
    avatar: () => document.createElement("span"),
    bridge: {
      desktopSettings: async () => ({ closeToTray: true, openAtLogin: false, packaged: true }),
      saveDesktopSettings: async (patch) => {
        saved = patch;
        return { closeToTray: patch.closeToTray !== false, openAtLogin: patch.openAtLogin === true, packaged: true };
      },
    },
  });
  settings.open();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.getElementById("settings-name").textContent, "Ada");
  assert.equal(document.getElementById("settings-display").textContent, "Ada");
  assert.equal(document.getElementById("startup-note").hidden, true);
  document.querySelector('[data-settings-page="audio"]').click();
  assert.equal(document.querySelector('[data-settings-panel="audio"]').hidden, false);
  assert.equal(document.querySelector('[data-settings-panel="account"]').hidden, true);
  document.getElementById("audio-noise").value = "off";
  document.getElementById("audio-noise").dispatchEvent(new dom.window.Event("change"));
  assert.equal(readAudioPreferences(storage).noiseSuppression, false);
  document.getElementById("video-quality").value = "hq";
  document.getElementById("video-quality").dispatchEvent(new dom.window.Event("change"));
  document.getElementById("video-fps").value = "60";
  document.getElementById("video-fps").dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(readVideoPreferences(storage), { quality: "hq", frameRate: 60 });
  document.getElementById("settings-search").value = "tray";
  document.getElementById("settings-search").dispatchEvent(new dom.window.Event("input"));
  assert.equal(document.querySelector('[data-settings-page="system"]').hidden, false);
  assert.equal(document.querySelector('[data-settings-page="audio"]').hidden, true);
  assert.equal(document.querySelector('p[data-settings-group="audio"]').hidden, true);
  document.getElementById("close-to-tray").checked = false;
  document.getElementById("close-to-tray").dispatchEvent(new dom.window.Event("change"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(saved, { closeToTray: false });
});
