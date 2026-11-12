const soundKey = "waystone-sounds";

function soundStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; }
  catch { return null; }
}

export function readSoundPreferences(storage) {
  const store = soundStorage(storage);
  try {
    const saved = JSON.parse(store?.getItem(soundKey) || "{}");
    return { enabled: saved.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

export function writeSoundPreferences(patch, storage) {
  const store = soundStorage(storage);
  const next = { enabled: patch.enabled !== false };
  store?.setItem(soundKey, JSON.stringify(next));
  return next;
}

export function joinedIds(previous, next) {
  const before = new Set((previous || []).map(String));
  return [...(next || [])].map(String).filter((id) => id && !before.has(id));
}

export function notifyForMessage(message, userId) {
  if (!message || message.user_id == null || userId == null) return false;
  return String(message.user_id) !== String(userId);
}

export function createSounds({ storage } = {}) {
  let context;
  const notes = { login: [523, 659], message: [784] };

  function contextFor() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    if (!context) context = new Ctx();
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }

  function play(kind) {
    if (!readSoundPreferences(storage).enabled) return;
    const ctx = contextFor();
    if (!ctx) return;
    const start = () => {
      const atStart = ctx.currentTime;
      for (const [index, frequency] of notes[kind].entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const at = atStart + index * 0.11;
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.18);
      }
    };
    if (ctx.state === "suspended") ctx.resume().then(start).catch(() => {});
    else start();
  }

  return { login: () => play("login"), message: () => play("message") };
}
