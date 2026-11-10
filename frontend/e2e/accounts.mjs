// Real Electron renderer and real Phoenix API, using an isolated temporary DB.
import { _electron as electron, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

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
  await page.locator("#server").fill(origin);
  await page.locator("#auth-mode").selectOption("register");
  await page.locator("#name").fill("real_friend");
  await page.locator("#display-name").fill("Real Friend");
  await page.locator("#password").fill(password);
  await page.locator("#invite").fill(invite);
  await page.locator("#auth-submit").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#add-channel")).toBeHidden();
  await page.locator("#profile-open").click();
  await page.locator("#profile-name").fill("Mountain Mage");
  await page.locator("#profile-bio").fill("Actual persisted profile");
  await page.locator("#profile-form button").click();
  await expect(page.locator("#identity")).toContainText("Mountain Mage");
  await page.locator("#body").fill("Message with a real user identity");
  await page.locator("#send").click();
  await expect(page.locator("#messages article.mine")).toHaveCount(1);
  await page.locator("#messages .author-profile").click();
  await expect(page.locator("#public-profile")).toContainText("Actual persisted profile");
  await page.locator('[data-close="public-profile-dialog"]').click();
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
  await page.locator("#leave").click(); await expect(page.locator("#join")).toBeVisible();
  await page.locator("#name").fill("real_friend"); await page.locator("#password").fill(password);
  await page.locator("#auth-submit").click();
  await expect(page.locator("#identity")).toContainText("Mountain Mage · moderator");
  await expect(page.locator("#add-channel")).toBeVisible();
  await page.locator("#profile-open").click();
  await expect(page.locator("#profile-bio")).toHaveValue("Actual persisted profile");
  await page.locator("#current-password").fill(password);
  await page.locator("#new-password").fill(password + "-updated");
  await page.locator("#password-form button").click(); await expect(page.locator("#join")).toBeVisible();
  await page.locator("#password").fill(password + "-updated"); await page.locator("#auth-submit").click();
  await expect(page.locator("#workspace")).toBeVisible();
  console.log("Real accounts smoke passed: registration, persistence, message ownership, public profile, admin promotion, moderator access, password change and re-login.");
} catch (error) {
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
