const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Tray, Menu, nativeImage, safeStorage, desktopCapturer } = require("electron");
const { autoUpdater } = require("electron-updater");
const { createUpdater } = require("./updater.cjs");
const { normalizeDesktopSettings, mergeDesktopSettings, hideOnClose } = require("./desktop-settings.cjs");
const { prepareSession, readStoredSession } = require("./session-store.cjs");
const { basename, join } = require("node:path");
const { createReadStream, createWriteStream } = require("node:fs");
const { writeFile, readFile, stat, unlink } = require("node:fs/promises");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { pathToFileURL } = require("node:url");
const { validateServer, validatePath } = require("./policy.cjs");
const { allowMicrophone } = require("./media-policy.cjs");
const { displayMediaStream } = require("./display-media.cjs");
const { validateBundle, boardContext } = require("./board-files.cjs");
const { CanvasStore } = require("./canvas-store.cjs");
const { validateCanvas } = require("./src/canvas-model.cjs");
// Honor an explicit profile before Chromium initializes storage. Tests and
// separate local instances must not inherit another instance's preferences.
const profile = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
if (profile) app.setPath("userData", profile.slice("--user-data-dir=".length));
let window, tray = null, quitting = false, chosenCapture = null;
let desktop = normalizeDesktopSettings();
const entry = pathToFileURL(join(__dirname, "index.html")).href;
function downloadName(name) {
  const base = String(name || "file").split(/[/\\]/).pop().replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120);
  return base && base !== "." && base !== ".." ? base : "file";
}
function trusted(event) {
  if (event.sender !== window?.webContents || event.senderFrame?.url !== entry)
    throw new Error("Untrusted caller");
}
const primary = !app.isPackaged || app.requestSingleInstanceLock();
if (!primary) app.quit();
app.whenReady().then(async () => {
  if (!primary) return;
  // Electron otherwise installs File, Edit, View, and Window. The hangout has its own controls.
  Menu.setApplicationMenu(null);
  desktop = await loadDesktopSettings();
  applyLoginItem();
  app.setAppUserModelId("dev.waystone.desktop");
  window = new BrowserWindow({
    width: 1250,
    height: 850,
    minWidth: 850,
    minHeight: 650,
    backgroundColor: "#101114",
    title: "Waystone",
    icon: join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (process.platform !== "darwin") window.removeMenu();
  window.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    const stream = displayMediaStream(chosenCapture);
    chosenCapture = null;
    if (stream) callback(stream);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(allowMicrophone(contents, window, entry, permission, details, true)),
  );
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      allowMicrophone(contents, window, entry, permission, details, false),
  );
  const updates = createUpdater({
    app, updater: autoUpdater, platform: process.platform,
    publish: (state) => { if (!window.isDestroyed()) window.webContents.send("update-status", state); },
    openRelease: (url) => shell.openExternal(url),
    confirmInstall: async () => {
      const result = await dialog.showMessageBox(window, {
        type: "question", buttons: ["Cancel", "Restart and install"], defaultId: 0, cancelId: 0,
        message: "Restart Waystone to install the update?",
        detail: "Save your Canvases and boards first. Calls will end and unsent attachments will be lost.",
      });
      return result.response === 1;
    },
  });
  for (const [name, action] of Object.entries({
    "update-status": () => updates.status(), "update-check": () => updates.check(),
    "update-download": () => updates.download(), "update-install": () => updates.install(),
  })) ipcMain.handle(name, (event) => { trusted(event); return action(); });
  window.webContents.once("did-finish-load", () => updates.check({ installOnReady: true }));
  const updateTimer = setInterval(() => updates.check(), 6 * 60 * 60 * 1000);
  updateTimer.unref();
  window.once("closed", () => clearInterval(updateTimer));
  window.on("close", (event) => {
    if (!hideOnClose({ closeToTray: trayWanted(), quitting })) return;
    event.preventDefault();
    window.hide();
  });
  syncTray();
  app.on("second-instance", () => showWindow());
  app.on("before-quit", (event) => {
    if (!event.defaultPrevented) quitting = true;
  });
  ipcMain.handle("session-load", async (event) => { trusted(event); return loadSession(); });
  ipcMain.handle("session-save", async (event, value) => {
    trusted(event);
    const stored = prepareSession(value, protectToken);
    if (!stored) throw new Error("Invalid session");
    await writeFile(sessionPath(), JSON.stringify(stored));
    return { remembered: true };
  });
  ipcMain.handle("session-clear", async (event) => {
    trusted(event);
    await unlink(sessionPath()).catch((error) => { if (error.code !== "ENOENT") throw error; });
    return { remembered: false };
  });
  ipcMain.handle("desktop-settings", (event) => { trusted(event); return publicDesktop(); });
  ipcMain.handle("desktop-settings-save", async (event, patch) => {
    trusted(event);
    desktop = mergeDesktopSettings(desktop, patch);
    await writeFile(join(app.getPath("userData"), "desktop-settings.json"), JSON.stringify(desktop));
    applyLoginItem();
    syncTray();
    return publicDesktop();
  });
  ipcMain.handle(
    "request",
    async (event, { server, path, token, body, method, binary = false }) => {
      trusted(event);
      const base = validateServer(server);
      validatePath(path);
      const verb = method || (body ? "POST" : "GET");
      if (!["GET", "POST", "PUT", "DELETE"].includes(verb))
        throw new Error("Unsupported request method.");
      const response = await fetch(base + path, {
        method: verb,
        redirect: "error",
        signal: AbortSignal.timeout(verb === "PUT" && /^\/api\/me\/media\/(avatar|banner)$/.test(path) ? 180000 : 60000),
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const details = Object.entries(error.fields || {}).map(([field, messages]) => `${field.replaceAll("_", " ")}: ${messages.join(", ")}`).join("; ");
        throw new Error(details || error.error || `Request failed (${response.status})`);
      }
      return binary
        ? new Uint8Array(await response.arrayBuffer())
        : response.json();
    },
  );
  ipcMain.handle("capture-sources", async (event) => {
    trusted(event);
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false,
    });
    return sources
      .map((source) => ({
        id: source.id,
        name: String(source.name || (source.id.startsWith("screen:") ? "Screen" : "Window")).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || "Window",
        kind: source.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL(),
      }))
      .filter((source) => /^(screen|window):\d+:\d+$/.test(source.id))
      .sort((a, b) => Number(b.kind === "screen") - Number(a.kind === "screen") || a.name.localeCompare(b.name));
  });
  ipcMain.on("capture-choose", (event, source) => {
    try {
      trusted(event);
      const stream = displayMediaStream(source);
      if (!stream) throw new Error("Choose a window or screen.");
      chosenCapture = stream.video;
      event.returnValue = true;
    } catch (error) {
      event.returnValue = { error: error.message || "Choose a window or screen." };
    }
  });
  ipcMain.handle("share-file", async (event, { server, token, channelId }) => {
    trusted(event);
    const base = validateServer(server);
    if (typeof token !== "string" || token.length < 1 || token.length > 128 || /[\r\n]/.test(token))
      throw new Error("Please sign in again.");
    if (!Number.isInteger(channelId) || channelId < 1) throw new Error("Join a channel before sharing a file.");
    const picked = await dialog.showOpenDialog(window, { title: "Share a file", properties: ["openFile"] });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Choose a file.");
    if (info.size === 0) throw new Error("Choose a file that isn't empty.");
    if (info.size > 256 * 1024 * 1024) throw new Error("Files can be up to 256 MB.");
    const stream = createReadStream(filePath);
    try {
      const response = await fetch(`${base}/api/channels/${channelId}/files`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(basename(filePath)),
        },
        body: Readable.toWeb(stream),
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(1_800_000),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Could not share that file (${response.status})`);
      }
      const file = await response.json();
      if (!file || typeof file.id !== "string" || typeof file.name !== "string" || !Number.isInteger(file.byte_size))
        throw new Error("Could not share that file.");
      return { id: file.id, name: file.name, byte_size: file.byte_size };
    } finally {
      stream.destroy();
    }
  });
  ipcMain.handle("save-shared-file", async (event, { server, token, path, name }) => {
    trusted(event);
    const base = validateServer(server);
    validatePath(path);
    if (!/^\/api\/messages\/\d+\/attachments\/[0-9a-f-]{36}$/.test(path)) throw new Error("Invalid file");
    if (typeof token !== "string" || token.length < 1 || token.length > 128 || /[\r\n]/.test(token))
      throw new Error("Please sign in again.");
    const safe = downloadName(name);
    const result = await dialog.showSaveDialog(window, { defaultPath: safe });
    if (result.canceled || !result.filePath) return false;
    const response = await fetch(base + path, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(1_800_000),
    });
    if (!response.ok) throw new Error("Could not download that file.");
    await pipeline(Readable.fromWeb(response.body), createWriteStream(result.filePath));
    return true;
  });
  ipcMain.handle("copy-context", (event, text) => {
    trusted(event);
    if (typeof text !== "string" || text.length > 20_000_000)
      throw new Error("Invalid context");
    clipboard.writeText(text);
  });
  ipcMain.handle("save-export", async (event, { name, bytes }) => {
    trusted(event);
    if (
      !/^[a-z0-9-]+\.(zip|md)$/.test(name) ||
      !(bytes instanceof Uint8Array) ||
      bytes.length > 512 * 1024 * 1024
    )
      throw new Error("Invalid export");
    const result = await dialog.showSaveDialog(window, { defaultPath: name });
    if (result.canceled) return false;
    await writeFile(result.filePath, bytes);
    return true;
  });
  const canvasStore = new CanvasStore(
    join(app.getPath("userData"), "canvases"),
  );
  ipcMain.handle("list-canvases", async (event) => {
    trusted(event);
    return canvasStore.list();
  });
  ipcMain.handle("save-canvas", async (event, canvas) => {
    trusted(event);
    return canvasStore.save(canvas);
  });
  ipcMain.handle(
    "prune-channel-boards",
    async (event, { server, boardIds }) => {
      trusted(event);
      const origin = validateServer(server);
      if (
        !Array.isArray(boardIds) ||
        boardIds.some((id) => typeof id !== "string")
      )
        throw new Error("Invalid channel board list.");
      return canvasStore.pruneChannelBoards(origin, boardIds);
    },
  );
  ipcMain.handle("import-canvas", async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "Waystone Canvas", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    if ((await stat(result.filePaths[0])).size > 128 * 1024 * 1024)
      throw new Error("Canvas file is too large.");
    const value = JSON.parse(await readFile(result.filePaths[0], "utf8"));
    if (value?.format === "waystone-board" && value.board)
      delete value.board.channel;
    else if (value && typeof value === "object") delete value.channel;
    return value.format === "waystone-board"
      ? validateBundle(value)
      : validateCanvas(value);
  });
  ipcMain.handle("export-canvas", async (event, value) => {
    trusted(event);
    const document =
      value.format === "waystone-board"
        ? validateBundle(value)
        : validateCanvas(value);
    const canvas = document.format ? document.board : document;
    const result = await dialog.showSaveDialog(window, {
      defaultPath: canvas.id + ".canvas.json",
      filters: [{ name: "Waystone Canvas", extensions: ["json"] }],
    });
    if (result.canceled) return false;
    await writeFile(result.filePath, JSON.stringify(document, null, 2));
    return true;
  });
  ipcMain.handle(
    "export-board-context",
    async (event, { bundle, previews }) => {
      trusted(event);
      const valid = validateBundle(bundle);
      const result = await dialog.showSaveDialog(window, {
        defaultPath: valid.board.id + ".plan.zip",
        filters: [{ name: "Board context", extensions: ["zip"] }],
      });
      if (result.canceled) return false;
      await writeFile(result.filePath, boardContext(valid, previews || {}));
      return true;
    },
  );
  window.loadFile("index.html");
});
app.on("window-all-closed", () => { if (!trayWanted() || quitting) app.quit(); });
app.on("activate", () => showWindow());

function sessionPath() { return join(app.getPath("userData"), "session.json"); }
function protectToken(token) {
  if (!safeStorage.isEncryptionAvailable()) return { sealed: false, token };
  return { sealed: true, token: safeStorage.encryptString(token).toString("base64") };
}
async function loadSession() {
  try {
    return readStoredSession(JSON.parse(await readFile(sessionPath(), "utf8")), (packed) =>
      safeStorage.decryptString(Buffer.from(packed, "base64")));
  } catch {
    return null;
  }
}
function desktopPath() { return join(app.getPath("userData"), "desktop-settings.json"); }
async function loadDesktopSettings() {
  try { return normalizeDesktopSettings(JSON.parse(await readFile(desktopPath(), "utf8"))); }
  catch { return normalizeDesktopSettings(); }
}
function trayWanted() { return desktop.closeToTray && process.env.WAYSTONE_E2E !== "1"; }
function publicDesktop() { return { ...desktop, packaged: app.isPackaged }; }
function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: desktop.openAtLogin });
}
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function syncTray() {
  if (!trayWanted()) {
    tray?.destroy();
    tray = null;
    if (window && !window.isDestroyed() && !window.isVisible()) showWindow();
    return;
  }
  if (tray) return;
  const image = nativeImage.createFromPath(join(__dirname, "build", "icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip("Waystone");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Waystone", click: showWindow },
    { label: "Quit Waystone", click: () => app.quit() },
  ]));
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}
