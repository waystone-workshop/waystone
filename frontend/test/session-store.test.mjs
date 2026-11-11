import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSession, prepareSession, readStoredSession } from "../session-store.cjs";

test("a remembered session keeps the server and token and drops a password", () => {
  const session = normalizeSession({
    server: "https://mars.example.com",
    token: "opaque-token",
    username: "ada",
    password: "should-not-stick",
  });
  assert.deepEqual(session, { server: "https://mars.example.com", token: "opaque-token", username: "ada" });
  assert.equal(normalizeSession({ server: "https://mars.example.com", token: "" }), null);
  assert.equal(normalizeSession({ server: "file:///tmp", token: "opaque-token" }), null);
});

test("stored sessions round-trip through a seal and a rejected token is unreadable", () => {
  const stored = prepareSession(
    { server: "https://mars.example.com", token: "opaque-token", username: "ada" },
    (token) => ({ sealed: true, token: `sealed:${token}` }),
  );
  assert.equal(stored.token, "sealed:opaque-token");
  assert.deepEqual(readStoredSession(stored, (token) => token.slice("sealed:".length)), {
    server: "https://mars.example.com",
    token: "opaque-token",
    username: "ada",
  });
  assert.equal(readStoredSession(stored, () => { throw new Error("locked"); }), null);
});
