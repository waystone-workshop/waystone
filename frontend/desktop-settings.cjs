function normalizeDesktopSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    closeToTray: source.closeToTray !== false,
    openAtLogin: source.openAtLogin === true,
  };
}

function mergeDesktopSettings(current, patch) {
  const next = { ...normalizeDesktopSettings(current) };
  if (typeof patch?.closeToTray === "boolean") next.closeToTray = patch.closeToTray;
  if (typeof patch?.openAtLogin === "boolean") next.openAtLogin = patch.openAtLogin;
  return next;
}

function hideOnClose({ closeToTray, quitting }) {
  return closeToTray === true && quitting !== true;
}

module.exports = { normalizeDesktopSettings, mergeDesktopSettings, hideOnClose };
