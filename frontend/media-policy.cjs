// Never allow camera, display capture, or permissions from remote documents.
function allowMicrophone(contents, window, entry, permission, details, request) {
  if (!contents || contents !== window?.webContents || contents.getURL() !== entry || permission !== "media")
    return false;
  if (request) return details.requestingUrl === entry &&
    Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === "audio";
  return details.mediaType === "audio";
}
module.exports = { allowMicrophone };
