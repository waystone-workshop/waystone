import test from "node:test";
import assert from "node:assert/strict";
import { joinedIds, notifyForMessage, readSoundPreferences, writeSoundPreferences } from "../src/sounds.mjs";

test("sounds stay on until the listener turns them off", () => {
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  assert.equal(readSoundPreferences(storage).enabled, true);
  assert.equal(writeSoundPreferences({ enabled: false }, storage).enabled, false);
  assert.equal(readSoundPreferences(storage).enabled, false);
});

test("a login chime is for someone who was not already online", () => {
  assert.deepEqual(joinedIds(["1", "2"], ["1", "2", "3"]), ["3"]);
  assert.deepEqual(joinedIds(null, ["1"]), ["1"]);
  assert.deepEqual(joinedIds(["1"], ["1"]), []);
});

test("a message chime is for someone else's new message", () => {
  assert.equal(notifyForMessage({ user_id: 2 }, 1), true);
  assert.equal(notifyForMessage({ user_id: 1 }, 1), false);
  assert.equal(notifyForMessage({ user_id: null }, 1), false);
  assert.equal(notifyForMessage({ user_id: 2 }, null), false);
});
