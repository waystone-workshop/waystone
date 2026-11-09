import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createUpdater } from "../updater.cjs";

function setup({ packaged = true, platform = "win32" } = {}) {
  const updater = new EventEmitter();
  let checks = 0, installs = 0, opened;
  updater.checkForUpdates = async () => { checks++; return {}; };
  updater.quitAndInstall = () => { installs++; };
  const controller = createUpdater({
    app: { isPackaged: packaged, getVersion: () => "0.4.1" }, updater, platform,
    publish() {}, confirmInstall: async () => true, openRelease: async (url) => { opened = url; },
  });
  return { updater, controller, get checks() { return checks; }, get installs() { return installs; }, get opened() { return opened; } };
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

test("unsigned macOS builds offer the fixed release page rather than claiming automatic install", async () => {
  const f = setup({ platform: "darwin" });
  assert.equal(f.updater.autoDownload, false);
  f.updater.emit("update-available", { version: "0.4.2" });
  await f.controller.download();
  assert.equal(f.opened, "https://github.com/waystone-workshop/waystone/releases/latest");
  assert.equal(await f.controller.install(), false);
});
