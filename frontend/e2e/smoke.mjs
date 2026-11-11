// Exercises the real packaged renderer + preload + HTTP bridge against a test backend.
import { _electron as electron, expect } from "@playwright/test";
import { startBackend } from "../test/support/backend.mjs";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { origin, png, requests, close } = await startBackend();
const profile = await mkdtemp(join(tmpdir(), "waystone-smoke-"));
let application;
try {
  application = await electron.launch({
    args: [
      fileURLToPath(new URL("../main.cjs", import.meta.url)),
      `--user-data-dir=${profile}`,
    ],
    env: { ...process.env, WAYSTONE_E2E: "1" },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("load");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#connection-settings summary").click();
  await page.locator("#server").fill(origin);
  await page.locator("#name").fill("Ada");
  await page.locator("#password").fill("test-password-long");
  await page.locator("#join-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#messages")).toContainText("Let’s plan");
  await expect(page.locator("#people-online .person-row")).toHaveCount(2);
  await page.locator("#members-collapse").click();
  await expect(page.locator("#people-panel")).toBeHidden();
  await page.locator("#members-toggle").click();
  await expect(page.locator("#people-panel")).toBeVisible();
  await page.setViewportSize({ width: 700, height: 760 });
  await expect(page.locator("#people-panel")).toBeVisible();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Narrow layout overflows horizontally");
  await page.locator("#members-collapse").click();
  await expect(page.locator("#people-panel")).toBeHidden();
  await page.setViewportSize({ width: 1234, height: 785 });
  await page.locator("#members-toggle").click();
  await page.locator("#profile-open").click();
  await page.locator("#profile-name").fill("Ada the Mage");
  await page.locator("#profile-bio").fill("Games and mountain trails");
  await page.locator("#profile-color").selectOption("berry");
  await page.screenshot({ path: fileURLToPath(new URL("../../tmp/waystone-profile.png", import.meta.url)) });
  await page.locator("#profile-form button").click();
  await expect(page.locator("#identity")).toContainText("Ada the Mage");
  await page.locator("#members-open").click();
  await expect(page.locator("#members-list .member-row")).toHaveCount(2);
  await expect(page.locator('select[aria-label="Role for grace"]')).toBeVisible();
  await page.locator('[data-close="members-dialog"]').click();
  await page.locator("#body").fill('<script>alert("not executable")</script>');
  await page.locator("#send").click();
  await expect(page.locator("#messages")).toContainText(
    '<script>alert("not executable")</script>',
  );
  await expect(page.locator("article")).toHaveCount(2);
  await page
    .locator("#files")
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#pending img")).toHaveCount(1);
  await page.locator("#send").click();
  await expect(page.locator("#messages img")).toHaveCount(1);
  await page.locator("#draw").click();
  const canvas = page.locator("#canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 80);
  await page.mouse.up();
  await page.locator("#attach-drawing").click();
  await expect(page.locator("#pending img")).toHaveCount(1);
  await page.locator("#send").click();
  await expect(page.locator("#messages img")).toHaveCount(2);
  await page.locator("article input[type=checkbox]").first().check();
  await page.locator("article input[type=checkbox]").last().check();
  await page.locator(".room-menu summary").click();
  await page.locator("#export-open").click();
  await expect(page.locator("#export-preview")).toContainText("Waystone");
  if (!requests.some((path) => path.includes("from=1&to=4")))
    throw new Error("Export did not request selected range");
  await page.locator('[data-close="export-dialog"]').click();
  await page.locator("#body").fill("Keep this local draft");
  await page.locator("#space-open").click();
  await page.locator("#add-channel").click();
  await page.locator("#channel-name").fill("planning");
  await page.locator("#channel-form .primary").click();
  await expect(page.locator("#channel-title")).toHaveText("Planning");
  await expect(page.locator("article")).toHaveCount(0);
  await page.locator("#space-open").click();
  await page.locator("#space-search").fill("common");
  await expect(page.locator("#channels button")).toHaveCount(1);
  await page.locator("#channels button").first().click();
  await expect(page.locator("#body")).toHaveValue("Keep this local draft");
  await page.screenshot({
    path: process.env.WAYSTONE_SCREENSHOT || join(tmpdir(), "waystone-desktop.png"),
  });
  if (errors.length) throw new Error(errors.join("\n"));
  await page.locator("#settings-open").click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await page.locator('[data-settings-page="audio"]').click();
  await expect(page.locator("#audio-noise")).toBeVisible();
  await page.locator('[data-settings-page="system"]').click();
  await expect(page.locator("#close-to-tray")).toBeChecked();
  await expect(page.locator("#open-at-login")).not.toBeChecked();
  await page.locator("#settings-search").fill("password");
  await expect(page.locator('[data-settings-page="security"]')).toBeVisible();
  await expect(page.locator('[data-settings-page="audio"]')).toBeHidden();
  await page.locator("#settings-search").fill("");
  await page.locator("#leave").click();
  await expect(page.locator("#join")).toBeVisible();
  await page.locator("#auth-mode").selectOption("register");
  await page.locator("#name").fill("new_friend");
  await page.locator("#display-name").fill("Mountain Warlock");
  await page.locator("#password").fill("a-long-new-passphrase");
  await page.locator("#invite").fill("test-invitation");
  await page.locator("#join-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#identity")).toContainText("Mountain Warlock · member");
  await expect(page.locator("#add-channel")).toBeHidden();
  await expect(page.locator("#delete-channel")).toBeHidden();
  await page.locator("#members-open").click();
  await expect(page.locator("#members-list select")).toHaveCount(0);
  await page.locator('[data-close="members-dialog"]').click();
  await page.locator("#settings-open").click();
  await page.locator('[data-settings-page="security"]').click();
  await page.locator("#current-password").fill("a-long-new-passphrase");
  await page.locator("#new-password").fill("an-updated-passphrase");
  await page.locator("#password-form button").click();
  await expect(page.locator("#join")).toBeVisible();
  console.log(
    "Desktop smoke passed: login, profiles, members, registration, role controls, password change, live text, attachments, exports, channels and drafts.",
  );
} finally {
  await application?.close();
  await close();
  await rm(profile, { recursive: true, force: true });
}
