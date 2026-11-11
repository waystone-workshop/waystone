// Discord-style voice: one suppressor, echo cancellation, and 64 kbps Opus.
// Krisp is proprietary. Chromium voice isolation is the platform equivalent;
// RNNoise is the open model used when the platform does not provide one.
export const voiceCapture = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: { ideal: true },
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
};

const audioKey = "waystone-audio";

export function normalizeAudioPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    noiseSuppression: source.noiseSuppression !== false,
    echoCancellation: source.echoCancellation !== false,
    autoGainControl: source.autoGainControl !== false,
    deviceId: typeof source.deviceId === "string" ? source.deviceId : "",
  };
}

function audioStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; }
  catch { return null; }
}

export function readAudioPreferences(storage) {
  const store = audioStorage(storage);
  try { return normalizeAudioPreferences(JSON.parse(store?.getItem(audioKey) || "{}")); }
  catch { return normalizeAudioPreferences({}); }
}

export function writeAudioPreferences(patch, storage) {
  const store = audioStorage(storage);
  const next = normalizeAudioPreferences({ ...readAudioPreferences(store), ...patch });
  store?.setItem(audioKey, JSON.stringify(next));
  return next;
}

export function voiceCaptureFor(preferences) {
  const chosen = normalizeAudioPreferences(preferences);
  const capture = {
    echoCancellation: chosen.echoCancellation,
    noiseSuppression: chosen.noiseSuppression,
    autoGainControl: chosen.autoGainControl,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
  };
  if (chosen.noiseSuppression) capture.voiceIsolation = { ideal: true };
  if (chosen.deviceId) capture.deviceId = chosen.deviceId;
  return capture;
}

export const voicePublish = {
  audioPreset: { maxBitrate: 64000 },
  dtx: false,
  red: true,
};

export function microphoneConstraints(settings, noiseSuppression, preferences = {}) {
  const chosen = normalizeAudioPreferences(preferences);
  const constraints = {
    echoCancellation: chosen.echoCancellation,
    autoGainControl: chosen.autoGainControl,
    noiseSuppression,
  };
  if (settings.deviceId) constraints.deviceId = { exact: settings.deviceId };
  if (settings.sampleRate) constraints.sampleRate = settings.sampleRate;
  if (settings.channelCount) constraints.channelCount = settings.channelCount;
  return constraints;
}
