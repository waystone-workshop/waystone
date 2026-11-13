import { VoiceActivity } from './voice-activity.mjs';
class VoiceGate extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.detector = new VoiceActivity(options.processorOptions); this.gain = 0; this.frames = 0;
    this.port.onmessage = event => this.detector.configure(event.data);
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0], output = outputs[0]?.[0];
    if (!output) return true;
    if (!input) { output.fill(0); return true; }
    let sum = 0;
    for (const value of input) sum += value * value;
    const db = Math.max(-100, 20 * Math.log10(Math.max(1e-5, Math.sqrt(sum / input.length))));
    const state = this.detector.update(db, input.length / sampleRate);
    const target = state.open ? 1 : 0;
    // A short attack and gentle release avoid clicks at the threshold.
    const step = 1 / (sampleRate * (target ? 0.005 : 0.04));
    for (let i = 0; i < output.length; i++) {
      this.gain += Math.max(-step, Math.min(step, target - this.gain));
      output[i] = (input[i] || 0) * this.gain;
    }
    this.frames += input.length;
    if (this.frames >= sampleRate / 20) { this.port.postMessage(state); this.frames = 0; }
    return true;
  }
}
registerProcessor('waystone-voice-gate', VoiceGate);
