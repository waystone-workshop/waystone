// Requires the real Phoenix backend and voice/start.ps1 (or LiveKit) running.
// Uses synthetic microphones; no personal microphone audio is captured.
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const origin = process.env.WAYSTONE_TEST_SERVER || "http://localhost:4000";
const usernames = [process.env.WAYSTONE_TEST_USERNAME, process.env.WAYSTONE_TEST_USERNAME_2];
const passwords = [process.env.WAYSTONE_TEST_PASSWORD, process.env.WAYSTONE_TEST_PASSWORD_2];
if (usernames.some((value) => !value) || passwords.some((value) => !value))
  throw new Error("Set WAYSTONE_TEST_USERNAME/PASSWORD and WAYSTONE_TEST_USERNAME_2/PASSWORD_2 for two existing test accounts; the first needs moderator or admin role.");
const clients = [], profiles = [];
let clientIndex = 0;
try {
  for (const name of ["Audio test Ada", "Audio test Grace"]) {
    const profile = await mkdtemp(join(tmpdir(), "waystone-audio-"));
    profiles.push(profile);
    const app = await electron.launch({ args: [
      fileURLToPath(new URL("../main.cjs", import.meta.url)),
      `--user-data-dir=${profile}`, "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ], env: { ...process.env, WAYSTONE_E2E: "1" } });
    clients.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState("load");
    await page.evaluate(() => {
      const Native = window.RTCPeerConnection;
      window.testConnections = [];
      window.RTCPeerConnection = class extends Native {
        constructor(...args) { super(...args); window.testConnections.push(this); }
      };
    });
    await page.locator("#connection-settings summary").click();
    await page.locator("#server").fill(origin);
    await page.locator("#name").fill(usernames[clientIndex]);
    await page.locator("#password").fill(passwords[clientIndex]);
    clientIndex++;
    await page.locator("#join-form button").click();
    await expect(page.locator("#join-audio")).toBeEnabled();
    await page.locator("#join-audio").click();
    if (await page.locator("#voice-dialog").isVisible())
      await page.locator("#voice-rooms .voice-room-choice").first().click();
    await expect(page.locator("#call-state")).toHaveText("You're in", { timeout: 30000 });
  }
  const pages = await Promise.all(clients.map((app) => app.firstWindow()));
  for (const page of pages) {
    await expect(page.locator("#call-participants li")).toHaveCount(2);
    await expect.poll(() => page.evaluate(async () => {
      let received = 0;
      for (const pc of window.testConnections) {
        for (const stat of (await pc.getStats()).values())
          if (stat.type === "inbound-rtp" && stat.kind === "audio") received += stat.bytesReceived || 0;
      }
      return received;
    }), { timeout: 20000 }).toBeGreaterThan(0);
    await expect(page.locator("#call-audio audio")).toHaveCount(1);
  }
  await pages[0].screenshot({ path: fileURLToPath(new URL("../../tmp/audio-call.png", import.meta.url)) });
  await pages[0].locator("#call-mute").click();
  await expect(pages[0].locator("#call-mute")).toHaveAttribute("aria-label", "Unmute microphone");
  await expect(pages[1].locator("#call-participants")).toContainText("· muted");
  await pages[1].locator("#call-details summary").click();
  await pages[1].locator("#call-deafen").click();
  expect(await pages[1].locator("#call-audio audio").evaluate((audio) => audio.muted)).toBe(true);
  // Text navigation and board views must preserve the independent voice call.
  await pages[0].locator("#space-open").click();
  await pages[0].locator("#add-channel").click();
  await pages[0].locator("#channel-name").fill(`audio-smoke-${Date.now()}`);
  await pages[0].locator("#channel-form .primary").click();
  await expect(pages[0].locator("#call-panel")).toBeVisible();
  await expect(pages[1].locator("#call-participants li")).toHaveCount(2);
  await pages[0].locator("#open-channel-board").click();
  await expect(pages[0].locator("#board-dialog")).toBeVisible();
  await expect(pages[0].locator("#call-panel")).toBeVisible();
  await pages[0].locator("#conversation-view").click();
  await expect.poll(() => pages[0].evaluate(() =>
    window.testConnections.some((pc) => pc.connectionState === "connected"))).toBe(true);
  // Voice rooms can be changed explicitly without changing the current text space.
  const extraName = `voice-smoke-${Date.now()}`;
  await pages[0].locator("#call-details summary").click();
  await pages[0].locator("#voice-switch").click();
  await pages[0].locator("#add-voice-room").click();
  await pages[0].locator("#voice-room-name").fill(extraName);
  await pages[0].locator("#voice-create-form .primary").click();
  const extra = pages[0].locator(".voice-room-row").filter({ has: pages[0].getByRole("button", { name: `Delete voice room ${extraName}`, exact: true }) });
  pages[0].once("dialog", (dialog) => dialog.accept());
  await extra.locator(".voice-room-choice").click();
  await expect(pages[0].locator("#call-participants li")).toHaveCount(1);
  await expect(pages[1].locator("#call-participants li")).toHaveCount(1);
  await pages[0].locator("#call-details summary").click();
  await pages[0].locator("#voice-switch").click();
  pages[0].once("dialog", (dialog) => dialog.accept());
  await pages[0].locator("#voice-rooms .voice-room-choice").first().click();
  await expect(pages[0].locator("#call-participants li")).toHaveCount(2);
  await pages[0].locator("#call-details summary").click();
  await pages[0].locator("#voice-switch").click();
  pages[0].once("dialog", (dialog) => dialog.accept());
  await pages[0].getByRole("button", { name: `Delete voice room ${extraName}`, exact: true }).click();
  await expect(extra).toHaveCount(0);
  await pages[0].locator('[data-close="voice-dialog"]').click();
  pages[0].once("dialog", (dialog) => dialog.accept());
  await pages[0].locator(".room-menu summary").click();
  await pages[0].locator("#delete-channel").click();
  await expect(pages[0].locator("#call-panel")).toBeVisible();
  await expect(pages[1].locator("#call-participants li")).toHaveCount(2);
  await pages[1].locator("#call-leave").click();
  await expect(pages[1].locator("#call-panel")).toBeHidden();
  await pages[1].locator("#join-audio").click();
  await pages[1].locator("#voice-rooms .voice-room-choice").first().click();
  await expect(pages[1].locator("#call-state")).toHaveText("Audio connected");
  await pages[1].locator("#settings-open").click();
  await pages[1].locator("#leave").click();
  await expect(pages[1].locator("#call-panel")).toBeHidden();
  await expect.poll(() => pages[1].evaluate(() =>
    window.testConnections.every((pc) => pc.connectionState === "closed"))).toBe(true);
  console.log("Audio smoke passed: real two-client audio; text switching, board navigation and text deletion preserve voice; mute, deafen, leave/rejoin and signout release resources correctly.");
} finally {
  for (const app of clients) await app.close();
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}
