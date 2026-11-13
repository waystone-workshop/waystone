import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceActivity } from '../src/voice-activity.mjs';
import { normalizeAudioPreferences } from '../src/audio-quality.mjs';
const feed = (gate, db, duration) => { let result; for (let i = 0; i < duration / 0.01; i++) result = gate.update(db, 0.01); return result; };
test('manual sensitivity opens at its threshold and holds across short pauses', () => {
  const gate = new VoiceActivity({ inputMode: 'manual', inputThreshold: -40 });
  assert.equal(feed(gate, -60, 1).open, false);
  assert.equal(feed(gate, -30, 0.1).open, true);
  assert.equal(feed(gate, -60, 0.1).open, true);
  assert.equal(feed(gate, -60, 0.3).open, false);
  gate.configure({ inputMode: 'manual', inputThreshold: -65 });
  assert.equal(feed(gate, -60, 0.1).open, true);
});
test('automatic sensitivity adapts to the quiet floor, ignores isolated peaks, and admits speech', () => {
  const gate = new VoiceActivity();
  const quiet = feed(gate, -70, 3);
  feed(gate, -15, 0.1);
  const afterPeak = feed(gate, -70, 0.3);
  assert.equal(afterPeak.threshold, quiet.threshold);
  const fan = feed(gate, -55, 4);
  assert.ok(fan.threshold > quiet.threshold);
  assert.equal(fan.open, false);
  assert.equal(feed(gate, -25, 0.1).open, true);
});
test('sensitivity preferences migrate old settings and clamp malformed thresholds', () => {
  assert.equal(normalizeAudioPreferences({ noiseSuppression: false }).inputMode, 'automatic');
  assert.equal(normalizeAudioPreferences({ inputThreshold: 'oops' }).inputThreshold, -48);
  assert.equal(normalizeAudioPreferences({ inputMode: 'manual', inputThreshold: 100 }).inputThreshold, -10);
});
