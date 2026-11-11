import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AudioCall } from "../src/audio.mjs";
import { microphoneConstraints, voiceCapture, voiceCaptureFor, voicePublish } from "../src/audio-quality.mjs";
import { allowMicrophone } from "../media-policy.cjs";

function fixture(credentials = async () => ({ url: "ws://127.0.0.1:7880", token: "token" })) {
  const room = new EventEmitter();
  let enabled = false, stops = 0, snapshot, failure;
  room.remoteParticipants = new Map();
  room.localParticipant = {
    identity: "me", name: "Ada", get isMicrophoneEnabled() { return enabled; },
    async setMicrophoneEnabled(value) { enabled = value; },
  };
  room.connect = async () => {};
  room.startAudio = async () => {};
  room.disconnect = async () => { enabled = false; stops++; };
  const elements = [];
  const call = new AudioCall({
    createRoom: () => room, events: new Proxy({}, { get: (_, event) => event }),
    credentials, audioHost: { append: (node) => elements.push(node),
      replaceChildren: () => { elements.length = 0; }, querySelectorAll: () => elements },
    changed: (value) => { snapshot = value; }, failed: (error) => { failure = error; },
  });
  return { call, room, elements, get snapshot() { return snapshot; },
    get enabled() { return enabled; }, get stops() { return stops; }, get failure() { return failure; } };
}

test("audio joins with a microphone, mutes, deafens new tracks, and releases resources", async () => {
  const f = fixture();
  await f.call.join(1);
  assert.equal(f.snapshot.state, "connected");
  assert.equal(f.enabled, true);
  await f.call.mute();
  assert.equal(f.enabled, false);
  f.call.deafen();
  const audio = {};
  f.room.emit("TrackSubscribed", { kind: "audio", attach: () => audio });
  assert.equal(audio.muted, true);
  f.call.deafen();
  assert.equal(audio.muted, false);
  f.call.leave();
  assert.equal(f.snapshot.state, "idle");
  assert.equal(f.enabled, false);
  assert.equal(f.elements.length, 0);
  assert.equal(f.stops, 1);
});

test("leaving during credentials fetch never acquires a microphone", async () => {
  let resolve;
  const f = fixture(() => new Promise((r) => { resolve = r; }));
  const joining = f.call.join(1);
  f.call.leave();
  resolve({ url: "ws://127.0.0.1:7880", token: "token" });
  await joining;
  assert.equal(f.enabled, false);
  assert.equal(f.snapshot.state, "idle");
});

test("microphone failure cleans up the room and reconnect loss releases the mic", async () => {
  const f = fixture();
  f.room.localParticipant.setMicrophoneEnabled = async () => { throw new Error("Permission denied"); };
  await f.call.join(1);
  assert.equal(f.snapshot.state, "idle");
  assert.match(f.failure.message, /Permission denied/);
  assert.equal(f.stops, 1);
  const connected = fixture();
  await connected.call.join(1);
  connected.room.emit("Reconnecting");
  assert.equal(connected.snapshot.state, "reconnecting");
  connected.room.emit("Disconnected");
  assert.equal(connected.enabled, false);
});

test("autoplay denial offers resume without canceling the call", async () => {
  const f = fixture();
  f.room.startAudio = async () => { throw new Error("Playback needs a click"); };
  await f.call.join(1);
  assert.equal(f.snapshot.state, "connected");
  assert.equal(f.snapshot.playbackBlocked, true);
  f.call.leave();
});

test("canceling while audio playback starts never opens the microphone", async () => {
  const f = fixture();
  let unblock, started;
  const reachedPlayback = new Promise((resolve) => { started = resolve; });
  f.room.startAudio = () => { started(); return new Promise((resolve) => { unblock = resolve; }); };
  const joining = f.call.join(1);
  await reachedPlayback;
  f.call.leave();
  unblock();
  await joining;
  assert.equal(f.enabled, false);
  assert.equal(f.snapshot.state, "idle");
});

test("permission policy grants only audio in the bundled desktop document", () => {
  const entry = "file:///waystone/index.html";
  const contents = { getURL: () => entry }, window = { webContents: contents };
  const check = (permission, details, request = true) =>
    allowMicrophone(contents, window, entry, permission, details, request);
  assert.equal(check("media", { requestingUrl: entry, mediaTypes: ["audio"] }), true);
  assert.equal(check("media", { requestingUrl: entry, mediaTypes: ["audio", "video"] }), false);
  assert.equal(check("display-capture", {}), false);
  assert.equal(check("media", { requestingUrl: "https://remote.test", mediaTypes: ["audio"] }), false);
  assert.equal(check("media", { mediaType: "video" }, false), false);
  assert.equal(check("media", { mediaType: "audio" }, false), true);
});

test("voice publish matches a 64 kbps speech call", () => {
  assert.equal(voicePublish.audioPreset.maxBitrate, 64000);
  assert.equal(voicePublish.dtx, false);
  assert.equal(voicePublish.red, true);
  assert.equal(voiceCapture.echoCancellation, true);
  assert.equal(voiceCapture.noiseSuppression, true);
  assert.deepEqual(voiceCapture.voiceIsolation, { ideal: true });
  assert.deepEqual(voiceCapture.sampleRate, { ideal: 48000 });
  assert.deepEqual(voiceCapture.channelCount, { ideal: 1 });
});

test("microphone constraints keep the chosen device while switching suppression", () => {
  const settings = { deviceId: "mic-1", sampleRate: 48000, channelCount: 1, voiceIsolation: false };
  assert.deepEqual(microphoneConstraints(settings, false), {
    echoCancellation: true, autoGainControl: true, noiseSuppression: false,
    deviceId: { exact: "mic-1" }, sampleRate: 48000, channelCount: 1,
  });
});

function microphone(track) {
  const f = fixture();
  f.call.createProcessor = () => ({ name: "waystone-rnnoise" });
  f.call.microphoneSource = "microphone";
  f.room.localParticipant.getTrackPublication = (source) => source === "microphone" ? { track } : undefined;
  return f;
}

test("platform voice isolation is not stacked with the noise model", async () => {
  let used = false;
  const f = microphone({
    getSourceTrackSettings: () => ({ voiceIsolation: true, deviceId: "mic-1" }),
    setProcessor: async () => { used = true; },
    applyConstraints: async () => { throw new Error("constraints should stay untouched"); },
  });
  await f.call.join(1);
  assert.equal(used, false);
  assert.equal(f.snapshot.state, "connected");
});

test("voice preferences keep one suppressor unless the listener turns it off", () => {
  assert.equal(voiceCaptureFor().noiseSuppression, true);
  assert.deepEqual(voiceCaptureFor().voiceIsolation, voiceCapture.voiceIsolation);
  const quiet = voiceCaptureFor({ noiseSuppression: false, echoCancellation: false, deviceId: "mic-9" });
  assert.equal(quiet.noiseSuppression, false);
  assert.equal(quiet.echoCancellation, false);
  assert.equal(quiet.voiceIsolation, undefined);
  assert.equal(quiet.deviceId, "mic-9");
});

test("turning noise suppression off skips the noise model", async () => {
  const store = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.localStorage.setItem("waystone-audio", JSON.stringify({ noiseSuppression: false }));
  try {
    let used = false;
    const f = microphone({
      getSourceTrackSettings: () => ({}),
      setProcessor: async () => { used = true; },
      applyConstraints: async () => {},
    });
    await f.call.join(1);
    assert.equal(used, false);
    assert.equal(f.snapshot.state, "connected");
  } finally {
    if (store) globalThis.localStorage = store;
    else delete globalThis.localStorage;
  }
});

test("the noise model replaces browser suppression and a failure restores it", async () => {
  const constraints = [];
  const f = microphone({
    getSourceTrackSettings: () => ({ deviceId: "mic-1", noiseSuppression: true }),
    setProcessor: async (processor) => { assert.equal(processor.name, "waystone-rnnoise"); },
    applyConstraints: async (value) => { constraints.push(value.noiseSuppression); },
  });
  await f.call.join(1);
  assert.deepEqual(constraints, [false]);
  assert.equal(f.snapshot.state, "connected");

  const restored = [];
  const failed = microphone({
    getSourceTrackSettings: () => ({ deviceId: "mic-1" }),
    setProcessor: async () => { throw new Error("worklet unavailable"); },
    applyConstraints: async (value) => { restored.push(value.noiseSuppression); },
  });
  await failed.call.join(1);
  assert.deepEqual(restored, [false, true]);
  assert.equal(failed.snapshot.state, "connected");
});
