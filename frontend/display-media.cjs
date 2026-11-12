// Electron's display-media callback accepts a plain { id, name }. Passing the
// DesktopCapturerSource object itself is rejected, and the page then sees
// "Permission denied".
function displayMediaStream(chosen) {
  const id = typeof chosen === "string" ? chosen : chosen && chosen.id;
  if (typeof id !== "string" || !/^(screen|window):\d+:\d+$/.test(id)) return null;
  const fallback = id.startsWith("screen:") ? "Screen" : "Window";
  const raw = typeof chosen === "string" ? fallback : chosen.name;
  const name = String(raw || fallback).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || fallback;
  return { video: { id, name } };
}

module.exports = { displayMediaStream };
