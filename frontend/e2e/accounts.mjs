// Real Electron renderer and real Phoenix API, using an isolated temporary DB.
import { _electron as electron, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { animatedGif } from "../test/support/profile-gif.mjs";

const temp = await mkdtemp(join(tmpdir(), "waystone-accounts-"));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString("hex");
const invite = randomBytes(16).toString("hex");
const backendDir = fileURLToPath(new URL("../../backend/", import.meta.url));
const windows = process.platform === "win32";
const backend = spawn(windows ? "powershell.exe" : "mix", windows
  ? ["-NoProfile", "-Command", "& mix run --no-start ../frontend/test/support/accounts_server.exs"]
  : ["run", "--no-start", "../frontend/test/support/accounts_server.exs"], {
    cwd: backendDir,
    env: { ...process.env, MIX_ENV: "dev", PORT: String(port), WAYSTONE_ACCOUNT_TEST_DB: join(temp, "accounts.db"), WAYSTONE_ACCOUNT_TEST_PASSWORD: password, WAYSTONE_INVITE_CODE: invite },
    stdio: ["ignore", "pipe", "pipe"],
  });
let app;
let output = "";
backend.stdout.on("data", (chunk) => { output += chunk; });
backend.stderr.on("data", (chunk) => { output += chunk; });
try {
  await expect.poll(() => output.includes("ACCOUNTS_TEST_READY"), { timeout: 60000 }).toBe(true);
  app = await electron.launch({ args: [fileURLToPath(new URL("../main.cjs", import.meta.url)), `--user-data-dir=${join(temp, "desktop")}`] });
  const page = await app.firstWindow(); await page.waitForLoadState("load");
  await page.locator("#connection-settings summary").click();
  await page.locator("#server").fill(origin);
  await page.locator("#auth-mode").selectOption("register");
  await page.locator("#name").fill("real_friend");
  await page.locator("#display-name").fill("Real Friend");
  await page.locator("#password").fill(password);
  await page.locator("#invite").fill(invite);
  await page.locator("#auth-submit").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#people-online .person-row")).toHaveCount(1);
  await expect(page.locator("#add-channel")).toBeHidden();
  await page.locator("#profile-open").click();
  await page.locator("#profile-name").fill("Mountain Mage");
  await page.locator("#profile-bio").fill("Actual persisted profile");
  const art = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 320;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#202a40"; ctx.fillRect(0, 0, 960, 320);
    ctx.fillStyle = "#aeb8c8"; for (const [x, y] of [[72,35],[170,72],[275,24],[414,53],[560,31],[676,69],[784,28],[875,87]]) ctx.fillRect(x,y,2,2);
    ctx.fillStyle = "#e2d5ac"; ctx.beginPath(); ctx.arc(735,68,15,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#3c4861"; ctx.beginPath(); ctx.moveTo(0,250); for (const [x,y] of [[160,85],[280,215],[422,113],[560,225],[747,133],[960,235],[960,320],[0,320]]) ctx.lineTo(x,y); ctx.fill();
    ctx.fillStyle = "#273446"; ctx.beginPath(); ctx.moveTo(0,320); for (const [x,y] of [[190,191],[384,320],[611,204],[801,320],[960,240],[960,320]]) ctx.lineTo(x,y); ctx.fill();
    ctx.fillStyle = "#dba565"; ctx.beginPath(); ctx.moveTo(580,286); ctx.lineTo(589,260); ctx.lineTo(600,286); ctx.fill();
    const banner = canvas.toDataURL("image/png").split(",")[1];
    canvas.width = canvas.height = 120; ctx.fillStyle = "#826246"; ctx.fillRect(0,0,120,120); ctx.fillStyle = "#f0e4ce"; ctx.font = "54px sans-serif"; ctx.textAlign = "center"; ctx.fillText("M",60,80);
    return { banner, avatar: canvas.toDataURL("image/png").split(",")[1] };
  });
  await page.locator("#banner-upload").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: Buffer.from(art.banner, "base64") });
  await expect(page.locator("#profile-upload-status")).toHaveText("Banner saved.");
  await expect(page.locator("#profile-edit-banner img")).toBeVisible();
  await page.locator("#avatar-upload").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(art.avatar, "base64") });
  await expect(page.locator("#profile-upload-status")).toHaveText("Avatar saved.");
  await expect(page.locator("#profile-edit-avatar img")).toBeVisible();
  if (process.env.WAYSTONE_TEST_LARGE_MEDIA === "1") {
    for (const [kind, size] of [["avatar", 10], ["banner", 20]]) {
      const buffer = animatedGif(size * 1024 * 1024);
      await page.locator(`#${kind}-upload`).setInputFiles({ name: `${kind}.gif`, mimeType: "image/gif", buffer });
      await expect(page.locator("#profile-upload-status")).toHaveText(`${kind === "avatar" ? "Avatar" : "Banner"} saved.`, { timeout: 30000 });
      await expect(page.locator(`#profile-edit-${kind} img`)).toBeVisible();
      const decoded = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const decoder = new ImageDecoder({ data: bytes, type: "image/gif" });
        await decoder.tracks.ready;
        const frames = decoder.tracks.selectedTrack.frameCount;
        const { image } = await decoder.decode({ frameIndex: 1 }); image.close(); decoder.close(); return frames;
      }, animatedGif(256).toString("base64"));
      if (decoded !== 2) throw Error("Animated GIF frames were not retained");
    }
    console.log("Large profile media passed: 10 MB avatar and 20 MB banner GIFs upload, render, and retain two animation frames.");
  }
  await page.locator("#profile-form button").click();
  await expect(page.locator("#identity")).toContainText("Mountain Mage");
  await expect(page.locator("#profile-dialog")).not.toBeVisible();
  await page.locator("#body").fill("Message with a real user identity");
  await expect(page.locator("#body")).toHaveValue("Message with a real user identity");
  await page.locator("#send").click();
  await expect(page.locator("#messages article.mine")).toHaveCount(1);
  await page.locator("#messages .author-profile").click();
  await expect(page.locator("#profile-card")).toContainText("Actual persisted profile");
  await expect(page.locator("#profile-card .profile-banner img")).toBeVisible();
  await page.locator("#profile-popover-close").click();
  await page.locator("#people-online .person-row").first().click();
  await expect(page.locator("#profile-card .profile-banner img")).toBeVisible();
  await page.screenshot({ path: fileURLToPath(new URL("../../tmp/hangout-profile.png", import.meta.url)) });
  await page.locator("#view-full-profile").click();
  await expect(page.locator("#public-profile")).toContainText("Actual persisted profile");
  await page.locator('[data-close="public-profile-dialog"]').click();
  await page.locator("#open-channel-board").click();
  await expect(page.locator("#board-dialog")).toHaveClass(/is-embedded/);
  await expect(page.locator("#open-channel-board")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#conversation-view").click();
  await expect(page.locator("#board-dialog")).not.toBeVisible();
  await page.locator("#settings-open").click();
  await page.locator("#leave").click();
  await expect(page.locator("#join")).toBeVisible();
  await page.locator("#auth-mode").selectOption("login");
  await page.locator("#name").fill("test_admin");
  await page.locator("#password").fill(password);
  await page.locator("#auth-submit").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("#members-open").click();
  const row = page.locator(".member-row").filter({ has: page.getByRole("combobox", { name: "Role for real_friend" }) });
  await row.getByRole("combobox").selectOption("moderator");
  await row.getByRole("button", { name: "Save role", exact: true }).click();
  await expect(page.locator(".member-row").filter({ hasText: "@real_friend" }).locator(".role-label")).toHaveText("moderator");
  await page.locator('[data-close="members-dialog"]').click();
  await page.locator("#settings-open").click();
  await page.locator("#leave").click(); await expect(page.locator("#join")).toBeVisible();
  await page.locator("#name").fill("real_friend"); await page.locator("#password").fill(password);
  await page.locator("#auth-submit").click();
  await expect(page.locator("#identity")).toContainText("Mountain Mage · moderator");
  await page.locator("#space-open").click();
  await expect(page.locator("#add-channel")).toBeVisible();
  await page.locator('[data-close="space-dialog"]').click();
  await page.locator("#profile-open").click();
  await expect(page.locator("#profile-bio")).toHaveValue("Actual persisted profile");
  await page.locator("#current-password").fill(password);
  await page.locator("#new-password").fill(password + "-updated");
  await page.locator("#password-form button").click(); await expect(page.locator("#join")).toBeVisible();
  await page.locator("#password").fill(password + "-updated"); await page.locator("#auth-submit").click();
  await expect(page.locator("#workspace")).toBeVisible();
  console.log("Real accounts smoke passed: registration, persistence, message ownership, public profile, admin promotion, moderator access, password change and re-login.");
  if (process.env.WAYSTONE_TEST_AUDIO === "1") {
    const audio = spawn(process.execPath, [fileURLToPath(new URL("./audio.mjs", import.meta.url))], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, WAYSTONE_TEST_SERVER: origin, WAYSTONE_TEST_USERNAME: "test_admin", WAYSTONE_TEST_PASSWORD: password, WAYSTONE_TEST_USERNAME_2: "real_friend", WAYSTONE_TEST_PASSWORD_2: password + "-updated" },
    });
    const code = await new Promise((resolve) => audio.once("exit", resolve));
    if (code !== 0) throw Error("Real independent voice integration failed");
  }
} catch (error) {
  if (app) {
    const window = await app.firstWindow();
    console.error("Desktop notice:", await window.locator("#notice").innerText());
    await window.screenshot({ path: fileURLToPath(new URL("../../tmp/accounts-failure.png", import.meta.url)) });
  }
  // Do not print server output: authentication inputs must stay out of test logs.
  throw error;
} finally {
  await app?.close();
  if (windows) {
    await new Promise((resolve) => { const stop = spawn("taskkill.exe", ["/PID", String(backend.pid), "/T", "/F"], { stdio: "ignore" }); stop.on("exit", resolve); });
  } else { backend.kill("SIGTERM"); }
  if (backend.exitCode === null) await new Promise((resolve) => backend.once("exit", resolve));
  await rm(temp, { recursive: true, force: true });
}
