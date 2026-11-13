// Level-based voice activity with a rolling quiet floor and a short hangover.
// It gates background sound between phrases; RNNoise handles noise during speech.
export class VoiceActivity {
  constructor(preferences = {}) {
    this.levels = []; this.elapsed = 0; this.lastVoice = -Infinity;
    this.noiseFloor = -65; this.open = false; this.configure(preferences);
  }
  configure(preferences) {
    this.mode = preferences.inputMode === 'manual' ? 'manual' : 'automatic';
    const value = Number(preferences.inputThreshold);
    this.manualThreshold = Number.isFinite(value) ? Math.max(-70, Math.min(-10, value)) : -48;
  }
  update(db, seconds) {
    this.elapsed += seconds;
    this.levels.push({ db, time: this.elapsed });
    while (this.levels[0]?.time < this.elapsed - 3) this.levels.shift();
    // Recompute at 10 Hz, using a quiet percentile rather than speech peaks.
    if (!this.nextFloor || this.elapsed >= this.nextFloor) {
      const sorted = this.levels.map(item => item.db).sort((a, b) => a - b);
      this.noiseFloor = Math.max(-80, Math.min(-40, sorted[Math.floor((sorted.length - 1) * 0.15)] ?? -65));
      this.nextFloor = this.elapsed + 0.1;
    }
    const threshold = this.mode === 'manual' ? this.manualThreshold : Math.max(-65, Math.min(-28, this.noiseFloor + 12));
    if (db >= threshold || (this.open && db >= threshold - 6)) this.lastVoice = this.elapsed;
    this.open = this.elapsed - this.lastVoice < 0.22;
    return { db, threshold, open: this.open };
  }
}
