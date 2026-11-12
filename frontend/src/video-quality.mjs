// Picture size and frame rate are chosen separately. Bitrate follows both,
// using the 30 fps rate as the baseline for each size.
const qualities = {
  "720": { width: 1280, height: 720, bitrate: 2_000_000 },
  "1080": { width: 1920, height: 1080, bitrate: 4_000_000 },
  hq: { width: 2560, height: 1440, bitrate: 8_000_000 },
};
const frameRates = [15, 30, 60];
const videoKey = "waystone-video";

export function normalizeVideoPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    quality: Object.hasOwn(qualities, source.quality) ? source.quality : "1080",
    frameRate: frameRates.includes(Number(source.frameRate)) ? Number(source.frameRate) : 30,
  };
}

function videoStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; }
  catch { return null; }
}

export function readVideoPreferences(storage) {
  const store = videoStorage(storage);
  try { return normalizeVideoPreferences(JSON.parse(store?.getItem(videoKey) || "{}")); }
  catch { return normalizeVideoPreferences({}); }
}

export function writeVideoPreferences(patch, storage) {
  const store = videoStorage(storage);
  const next = normalizeVideoPreferences({ ...readVideoPreferences(store), ...patch });
  store?.setItem(videoKey, JSON.stringify(next));
  return next;
}

export function videoCaptureFor(preferences) {
  const chosen = normalizeVideoPreferences(preferences);
  const preset = qualities[chosen.quality];
  return {
    resolution: { width: preset.width, height: preset.height, frameRate: chosen.frameRate },
    encoding: {
      maxBitrate: Math.round(preset.bitrate * chosen.frameRate / 30),
      maxFramerate: chosen.frameRate,
    },
  };
}
