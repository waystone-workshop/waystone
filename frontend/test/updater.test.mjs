import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createUpdater } from "../updater.cjs";

function setup({ packaged = true, platform = "win32" } = {}) {
  const updater = new EventEmitter();
  let checks = 0, installs = 0, opened, installerArgs;
  updater.checkForUpdates = async () => { checks++; return {}; };
  updater.quitAndInstall = (...args) => { installs++; installerArgs = args; };
  const controller = createUpdater({
    app: { isPackaged: packaged, getVersion: () => "0.4.1" }, updater, platform,
    publish() {}, confirmInstall: async () => true, openRelease: async (url) => { opened = url; },
  });
  return { updater, controller, get checks() { return checks; }, get installs() { return installs; }, get opened() { return opened; }, get installerArgs() { return installerArgs; } };
}

test("Windows downloads automatically and installs on normal quit without interrupting a session", async () => {
  const f = setup();
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  assert.equal(f.updater.autoRunAppAfterInstall, false);
  f.updater.emit("update-available", { version: "0.4.2" });
  assert.equal(f.controller.status().phase, "downloading");
  f.updater.emit("update-downloaded", { version: "0.4.2" });
  assert.equal(f.installs, 0);
  assert.equal(f.controller.status().phase, "downloaded");
  assert.equal(await f.controller.install(), true);
  assert.equal(f.installs, 1);
  assert.deepEqual(f.installerArgs, [true, true]);
});

test("development does not access releases and download failures are caught", async () => {
  const dev = setup({ packaged: false });
  await dev.controller.check();
  assert.equal(dev.checks, 0);
  assert.equal(dev.controller.status().phase, "disabled");
  const f = setup();
  f.updater.checkForUpdates = async () => ({ downloadPromise: Promise.reject(new Error("offline")) });
  await f.controller.check();
  assert.equal(f.controller.status().phase, "error");
});

test("a newer release replaces a downloaded update and quit installs only the latest", async () => {
  const quits = [];
  const app = {
    isPackaged: true, getVersion: () => "0.6.0",
    on(event, listener) { if (event === "before-quit") quits.push(listener); },
    quit() { for (const listener of quits) listener({ preventDefault() {} }); },
  };
  let latest = "0.6.1";
  const updater = new EventEmitter();
  let installs = 0;
  let installerArgs;
  updater.autoDownload = true;
  updater.checkForUpdates = async () => {
    const version = latest;
    updater.emit("update-available", { version });
    const downloadPromise = Promise.resolve().then(() => updater.emit("update-downloaded", { version }));
    return { updateInfo: { version }, downloadPromise };
  };
  updater.quitAndInstall = (...args) => { installs++; installerArgs = args; };
  const controller = createUpdater({
    app, updater, platform: "win32", publish() {}, confirmInstall: async () => true, openRelease: async () => {},
  });
  assert.equal(updater.autoInstallOnAppQuit, false);
  await controller.check();
  assert.equal(controller.status().version, "0.6.1");
  latest = "0.6.2";
  await controller.check();
  assert.equal(controller.status().version, "0.6.2");
  assert.match(controller.status().message, /installs it when it opens/);
  assert.equal(installs, 0);
  app.quit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installs, 1);
  assert.deepEqual(installerArgs, [true, true]);
  assert.equal(controller.status().version, "0.6.2");
});

test("opening Waystone installs a downloaded update without asking", async () => {
  const updater = new EventEmitter();
  let installerArgs;
  let confirmed = false;
  updater.checkForUpdates = async () => {
    const downloadPromise = Promise.resolve().then(() => updater.emit("update-downloaded", { version: "0.6.5" }));
    return { updateInfo: { version: "0.6.5" }, downloadPromise };
  };
  updater.quitAndInstall = (...args) => { installerArgs = args; };
  const controller = createUpdater({
    app: { isPackaged: true, getVersion: () => "0.6.4" }, updater, platform: "win32",
    publish() {}, confirmInstall: async () => { confirmed = true; return false; }, openRelease: async () => {},
  });
  await controller.check({ installOnReady: true });
  assert.deepEqual(installerArgs, [true, true]);
  assert.equal(confirmed, false);
  assert.equal(controller.status().phase, "downloaded");
});

test("unsigned macOS builds offer the fixed release page rather than claiming automatic install", async () => {
  const f = setup({ platform: "darwin" });
  assert.equal(f.updater.autoDownload, false);
  f.updater.emit("update-available", { version: "0.4.2" });
  await f.controller.download();
  assert.equal(f.opened, "https://github.com/waystone-workshop/waystone/releases/latest");
  assert.equal(await f.controller.install(), false);
});
