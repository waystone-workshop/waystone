// Requires the real Phoenix backend and voice/start.ps1 (or LiveKit) running.
// Uses synthetic microphones; no personal microphone audio is captured.
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const origin = process.env.WAYSTONE_TEST_SERVER || "http://localhost:4000";
const clients = [], profiles = [];
try {
  for (const name of ["Audio test Ada", "Audio test Grace"]) {
    const profile = await mkdtemp(join(tmpdir(), "waystone-audio-"));
    profiles.push(profile);
    const app = await electron.launch({ args: [
      fileURLToPath(new URL("../main.cjs", import.meta.url)),
      `--user-data-dir=${profile}`, "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ] });
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
    await page.locator("#server").fill(origin);
    await page.locator("#name").fill(name);
    await page.locator("#join-form button").click();
    await expect(page.locator("#join-audio")).toBeEnabled();
    await page.locator("#join-audio").click();
    await expect(page.locator("#call-state")).toHaveText("Audio connected", { timeout: 30000 });
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
  await expect(pages[0].locator("#call-mute")).toHaveText("Unmute");
  await expect(pages[1].locator("#call-participants")).toContainText("Audio test Ada · muted");
  await pages[1].locator("#call-deafen").click();
  expect(await pages[1].locator("#call-audio audio").evaluate((audio) => audio.muted)).toBe(true);
  // Changing text channels must release the current room and microphone.
  await pages[0].locator("#add-channel").click();
  await pages[0].locator("#channel-name").fill(`audio-smoke-${Date.now()}`);
  await pages[0].locator("#channel-form .primary").click();
  await expect(pages[0].locator("#call-panel")).toBeHidden();
  await expect(pages[1].locator("#call-participants li")).toHaveCount(1);
  await expect.poll(() => pages[0].evaluate(() =>
    window.testConnections.every((pc) => pc.connectionState === "closed"))).toBe(true);
  pages[0].once("dialog", (dialog) => dialog.accept());
  await pages[0].locator("#delete-channel").click();
  await pages[1].locator("#call-leave").click();
  await expect(pages[1].locator("#call-panel")).toBeHidden();
  await pages[1].locator("#join-audio").click();
  await expect(pages[1].locator("#call-state")).toHaveText("Audio connected");
  await pages[1].locator("#leave").click();
  await expect(pages[1].locator("#call-panel")).toBeHidden();
  await expect.poll(() => pages[1].evaluate(() =>
    window.testConnections.every((pc) => pc.connectionState === "closed"))).toBe(true);
  console.log("Audio smoke passed: two real Electron clients exchange audio via LiveKit; mute, deafen, channel switch, leave/rejoin, and workspace cleanup work.");
} finally {
  for (const app of clients) await app.close();
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}
