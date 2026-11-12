// Camera and display capture are allowed only from the bundled desktop page,
// and only as their own request. A remote document cannot capture anything.
function allowMicrophone(contents, window, entry, permission, details, request) {
  if (!contents || contents !== window?.webContents || contents.getURL() !== entry) return false;
  if (permission === "display-capture") return true;
  if (permission !== "media") return false;
  if (request) {
    return details.requestingUrl === entry && Array.isArray(details.mediaTypes) &&
      details.mediaTypes.length === 1 && ["audio", "video"].includes(details.mediaTypes[0]);
  }
  return details.mediaType === "audio" || details.mediaType === "video";
}
module.exports = { allowMicrophone };
