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

export const voicePublish = {
  audioPreset: { maxBitrate: 64000 },
  dtx: false,
  red: true,
};

export function microphoneConstraints(settings, noiseSuppression) {
  const constraints = { echoCancellation: true, autoGainControl: true, noiseSuppression };
  if (settings.deviceId) constraints.deviceId = { exact: settings.deviceId };
  if (settings.sampleRate) constraints.sampleRate = settings.sampleRate;
  if (settings.channelCount) constraints.channelCount = settings.channelCount;
  return constraints;
}
