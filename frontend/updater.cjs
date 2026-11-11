const RELEASES = "https://github.com/waystone-workshop/waystone/releases/latest";

function compareVersions(left, right) {
  const parse = (value) => String(value).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left), b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function createUpdater({ app, updater, platform, publish, confirmInstall, openRelease }) {
  let state = { phase: app.isPackaged ? "idle" : "disabled", current: app.getVersion(),
    message: app.isPackaged ? "Check for a new version." : "Updates are available in installed builds." };
  let checking = false, downloading = false, pendingVersion = null, settling = false, installing = false, activeCheck = null;
  const set = (change) => { state = { ...state, ...change }; publish(state); };
  const automatic = platform === "win32";
  // Quit is handled here so a newer release can replace one already downloaded.
  // electron-updater's own quit hook would install the older file immediately.
  const manageQuit = automatic && typeof app.on === "function";
  updater.autoDownload = automatic;
  updater.autoInstallOnAppQuit = automatic && !manageQuit;
  updater.autoRunAppAfterInstall = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on("update-available", (info) => set({ phase: automatic ? "downloading" : "available", version: info.version,
    percent: 0, message: automatic ? `Downloading version ${info.version} in the background…` : `Version ${info.version} is available.`, manual: !automatic }));
  updater.on("update-not-available", () => set({ phase: "current", message: "You're up to date." }));
  updater.on("download-progress", (progress) => set({ phase: "downloading",
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))), message: "Downloading update…" }));
  updater.on("update-downloaded", (info) => {
    if (pendingVersion && compareVersions(info.version, pendingVersion) < 0) return;
    const replaced = pendingVersion && compareVersions(info.version, pendingVersion) > 0;
    pendingVersion = info.version;
    set({ phase: "downloaded", version: info.version,
      message: replaced
        ? `Version ${info.version} includes the earlier updates. One restart installs it, then Waystone opens again.`
        : "Update ready. Restart Waystone and it installs in the background, then opens again." });
  });
  updater.on("error", () => set({ phase: "error", message: "Couldn't get the update. Try again later." }));

  async function check() {
    if (!app.isPackaged || state.phase === "available") return state;
    if (activeCheck) return activeCheck;
    const ready = state.phase === "downloaded" ? state : null;
    checking = true;
    if (!ready) set({ phase: "checking", message: "Checking for updates…" });
    activeCheck = (async () => {
      try {
        const result = await updater.checkForUpdates();
        if (result?.downloadPromise) {
          downloading = true;
          try { await result.downloadPromise; }
          finally { downloading = false; }
        }
      }
      catch {
        if (ready) set(ready);
        else set({ phase: "error", message: "Couldn't check for updates. Try again later." });
      }
      finally { checking = false; activeCheck = null; }
      return state;
    })();
    return activeCheck;
  }

  async function installReady() {
    if (installing || settling) return false;
    settling = true;
    try { await check(); }
    catch { /* A failed refresh keeps the update already downloaded. */ }
    if (state.phase !== "downloaded") { settling = false; return false; }
    installing = true;
    updater.quitAndInstall(true, true);
    return true;
  }

  if (manageQuit) {
    app.on("before-quit", (event) => {
      if (installing || !["downloaded", "downloading"].includes(state.phase)) return;
      event.preventDefault();
      if (settling) return;
      installReady().then((started) => {
        if (!started && !installing) app.quit();
      });
    });
  }

  return {
    status: () => ({ ...state }),
    check,
    async download() {
      if (state.phase !== "available" || downloading) return;
      if (state.manual) { await openRelease(RELEASES); return; }
      downloading = true;
      set({ phase: "downloading", percent: 0, message: "Downloading update…" });
      try { await updater.downloadUpdate(); }
      catch { set({ phase: "error", message: "Download failed. Check for updates to try again." }); }
      finally { downloading = false; }
    },
    async install() {
      if (state.phase !== "downloaded") return false;
      if (!(await confirmInstall())) return false;
      return installReady();
    },
  };
}
module.exports = { createUpdater, compareVersions };
