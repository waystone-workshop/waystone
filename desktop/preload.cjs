const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("waystone", {
  exportBoardContext: (options) =>
    ipcRenderer.invoke("export-board-context", options),
  pruneChannelBoards: (options) =>
    ipcRenderer.invoke("prune-channel-boards", options),
  listCanvases: () => ipcRenderer.invoke("list-canvases"),
  saveCanvas: (canvas) => ipcRenderer.invoke("save-canvas", canvas),
  importCanvas: () => ipcRenderer.invoke("import-canvas"),
  exportCanvas: (canvas) => ipcRenderer.invoke("export-canvas", canvas),
  request: (options) => ipcRenderer.invoke("request", options),
  copyContext: (text) => ipcRenderer.invoke("copy-context", text),
  saveExport: (options) => ipcRenderer.invoke("save-export", options),
});
