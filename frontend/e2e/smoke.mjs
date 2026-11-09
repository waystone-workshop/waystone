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
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("load");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#server").fill(origin);
  await page.locator("#name").fill("Ada");
  await page.locator("#join-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#messages")).toContainText("Let’s plan");
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
  await page.locator("#export-open").click();
  await expect(page.locator("#export-preview")).toContainText("Waystone");
  if (!requests.some((path) => path.includes("from=1&to=4")))
    throw new Error("Export did not request selected range");
  await page.locator('[data-close="export-dialog"]').click();
  await page.locator("#body").fill("Keep this local draft");
  await page.locator("#add-channel").click();
  await page.locator("#channel-name").fill("planning");
  await page.locator("#channel-form .primary").click();
  await expect(page.locator("#channel-title")).toHaveText("# planning");
  await expect(page.locator("article")).toHaveCount(0);
  await page.locator("#channels button").first().click();
  await expect(page.locator("#body")).toHaveValue("Keep this local draft");
  await page.screenshot({
    path: process.env.WAYSTONE_SCREENSHOT || join(tmpdir(), "waystone-desktop.png"),
  });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Desktop smoke passed: join, live text, safe rendering, picture, drawing, selected export, channel isolation and local drafts.",
  );
} finally {
  await application?.close();
  await close();
  await rm(profile, { recursive: true, force: true });
}
