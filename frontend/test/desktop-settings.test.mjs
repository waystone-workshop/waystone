import test from "node:test";
import assert from "node:assert/strict";
import { hideOnClose, mergeDesktopSettings, normalizeDesktopSettings } from "../desktop-settings.cjs";

test("the close button hides Waystone unless the listener turns the tray off or quits", () => {
  assert.deepEqual(normalizeDesktopSettings(undefined), { closeToTray: true, openAtLogin: false });
  assert.deepEqual(mergeDesktopSettings({ closeToTray: true, openAtLogin: false }, { openAtLogin: true, extra: true }), {
    closeToTray: true, openAtLogin: true,
  });
  assert.equal(mergeDesktopSettings({ closeToTray: true }, { closeToTray: "no" }).closeToTray, true);
  assert.equal(hideOnClose({ closeToTray: true, quitting: false }), true);
  assert.equal(hideOnClose({ closeToTray: true, quitting: true }), false);
  assert.equal(hideOnClose({ closeToTray: false, quitting: false }), false);
});
