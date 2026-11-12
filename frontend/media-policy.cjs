// Camera, microphone, and display capture are allowed only from the bundled
// desktop page. A remote document cannot capture anything.
function allowMicrophone(contents, window, entry, permission, details, request) {
  if (!contents || contents !== window?.webContents || contents.getURL() !== entry) return false;
  if (permission === "display-capture") return true;
  if (permission !== "media") return false;
  if (request) {
    // Screen share arrives as a media request with no listed types. A microphone
    // or camera is one type. Combined audio and video stays closed.
    return details.requestingUrl === entry && Array.isArray(details.mediaTypes) &&
      (details.mediaTypes.length === 0 ||
        (details.mediaTypes.length === 1 && ["audio", "video"].includes(details.mediaTypes[0])));
  }
  return details.mediaType === "audio" || details.mediaType === "video";
}
module.exports = { allowMicrophone };
