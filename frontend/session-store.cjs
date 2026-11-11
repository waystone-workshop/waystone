const { validateServer } = require("./policy.cjs");

function normalizeSession(value) {
  if (!value || typeof value !== "object") return null;
  const token = typeof value.token === "string" ? value.token.trim() : "";
  const username = typeof value.username === "string" ? value.username.slice(0, 24) : "";
  if (!token || token.length > 128) return null;
  try {
    return { server: validateServer(value.server), token, username };
  } catch {
    return null;
  }
}

function prepareSession(value, protect) {
  const session = normalizeSession(value);
  if (!session) return null;
  const packed = protect(session.token);
  if (!packed || typeof packed.token !== "string" || typeof packed.sealed !== "boolean") return null;
  return { server: session.server, username: session.username, sealed: packed.sealed, token: packed.token };
}

function readStoredSession(record, reveal) {
  if (!record || typeof record !== "object" || typeof record.token !== "string") return null;
  try {
    const token = record.sealed === true ? reveal(record.token) : record.token;
    return normalizeSession({ server: record.server, username: record.username, token });
  } catch {
    return null;
  }
}

module.exports = { normalizeSession, prepareSession, readStoredSession };
