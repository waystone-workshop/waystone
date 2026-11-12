const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("waystone", {
  updateStatus: () => ipcRenderer.invoke("update-status"),
  checkUpdate: () => ipcRenderer.invoke("update-check"),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  installUpdate: () => ipcRenderer.invoke("update-install"),
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  exportBoardContext: (options) =>
    ipcRenderer.invoke("export-board-context", options),
  pruneChannelBoards: (options) =>
    ipcRenderer.invoke("prune-channel-boards", options),
  listCanvases: () => ipcRenderer.invoke("list-canvases"),
  saveCanvas: (canvas) => ipcRenderer.invoke("save-canvas", canvas),
  importCanvas: () => ipcRenderer.invoke("import-canvas"),
  exportCanvas: (canvas) => ipcRenderer.invoke("export-canvas", canvas),
  request: (options) => ipcRenderer.invoke("request", options),
  shareFile: (payload) => ipcRenderer.invoke("share-file", payload),
  saveSharedFile: (payload) => ipcRenderer.invoke("save-shared-file", payload),
  captureSources: () => ipcRenderer.invoke("capture-sources"),
  chooseCapture: (source) => {
    const result = ipcRenderer.sendSync("capture-choose", source);
    if (result && result.error) throw new Error(result.error);
    return result;
  },
  copyContext: (text) => ipcRenderer.invoke("copy-context", text),
  saveExport: (options) => ipcRenderer.invoke("save-export", options),
  loadSession: () => ipcRenderer.invoke("session-load"),
  saveSession: (session) => ipcRenderer.invoke("session-save", session),
  clearSession: () => ipcRenderer.invoke("session-clear"),
  desktopSettings: () => ipcRenderer.invoke("desktop-settings"),
  saveDesktopSettings: (settings) => ipcRenderer.invoke("desktop-settings-save", settings),
});
