const RELEASES = "https://github.com/waystone-workshop/waystone/releases/latest";

function createUpdater({ app, updater, platform, publish, confirmInstall, openRelease }) {
  let state = { phase: app.isPackaged ? "idle" : "disabled", current: app.getVersion(),
    message: app.isPackaged ? "Check for a new version." : "Updates are available in installed builds." };
  let checking = false, downloading = false;
  const set = (change) => { state = { ...state, ...change }; publish(state); };
  const automatic = platform === "win32";
  updater.autoDownload = automatic;
  updater.autoInstallOnAppQuit = automatic;
  updater.autoRunAppAfterInstall = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on("update-available", (info) => set({ phase: automatic ? "downloading" : "available", version: info.version,
    percent: 0, message: automatic ? `Downloading version ${info.version} in the background…` : `Version ${info.version} is available.`, manual: !automatic }));
  updater.on("update-not-available", () => set({ phase: "current", message: "You're up to date." }));
  updater.on("download-progress", (progress) => set({ phase: "downloading",
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))), message: "Downloading update…" }));
  updater.on("update-downloaded", (info) => set({ phase: "downloaded", version: info.version,
    message: "Update ready. It will install when you close Waystone, or you can restart now." }));
  updater.on("error", () => set({ phase: "error", message: "Couldn't get the update. Try again later." }));
  return {
    status: () => ({ ...state }),
    async check() {
      if (!app.isPackaged || checking || downloading || ["available", "downloaded"].includes(state.phase)) return state;
      checking = true;
      set({ phase: "checking", message: "Checking for updates…" });
      try {
        const result = await updater.checkForUpdates();
        if (result?.downloadPromise) await result.downloadPromise;
      }
      catch { set({ phase: "error", message: "Couldn't check for updates. Try again later." }); }
      finally { checking = false; }
      return state;
    },
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
      updater.quitAndInstall(false, true);
      return true;
    },
  };
}
module.exports = { createUpdater };
