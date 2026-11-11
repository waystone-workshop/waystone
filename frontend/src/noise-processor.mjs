const worklets = new WeakMap();
const simdProbe = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

function wasmBinary(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function loadWorklet(context) {
  let pending = worklets.get(context);
  if (!pending) {
    // Resolved from index.html so the bundled script can be evaluated outside a module.
    const workletUrl = new URL("dist/rnnoise-worklet.js", document.baseURI);
    pending = context.audioWorklet.addModule(workletUrl);
    worklets.set(context, pending);
  }
  return pending;
}

async function closeContext(context, owns) {
  if (owns) await context.close().catch(() => {});
}

// RNNoise needs 48 kHz frames. A context at another rate would shift the voice,
// so the processor owns a 48 kHz context and lets the browser resample into it.
export function createNoiseProcessor() {
  let generation = 0;
  let context, source, node, destination, ownsContext = false;
  const processor = {
    name: "waystone-rnnoise",
    processedTrack: undefined,
    init(opts) { return processor.restart(opts); },
    async restart(opts) {
      const current = ++generation;
      await release();
      if (!opts.track || current !== generation) return;
      const provided = opts.audioContext;
      const owns = !provided || provided.sampleRate !== 48000;
      const created = owns ? new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }) : provided;
      const discard = async () => closeContext(created, owns);
      try {
        if (created.state === "suspended") await created.resume();
        if (current !== generation) return discard();
        await loadWorklet(created);
        if (current !== generation) return discard();
        const [{ RnnoiseWorkletNode }, simd, plain] = await Promise.all([
          import("@sapphi-red/web-noise-suppressor"),
          import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm"),
          import("@sapphi-red/web-noise-suppressor/rnnoise.wasm"),
        ]);
        const denoiser = new RnnoiseWorkletNode(created, {
          maxChannels: 1,
          wasmBinary: wasmBinary((await WebAssembly.validate(simdProbe) ? simd : plain).default),
        });
        const input = created.createMediaStreamSource(new MediaStream([opts.track]));
        const output = created.createMediaStreamDestination();
        input.connect(denoiser);
        denoiser.connect(output);
        if (current !== generation) {
          denoiser.destroy();
          input.disconnect();
          output.stream.getAudioTracks().forEach((track) => track.stop());
          return discard();
        }
        context = created;
        ownsContext = owns;
        source = input;
        node = denoiser;
        destination = output;
        processor.processedTrack = output.stream.getAudioTracks()[0];
      } catch (error) {
        await discard();
        throw error;
      }
    },
    destroy() {
      generation++;
      return release();
    },
  };

  async function release() {
    node?.destroy();
    source?.disconnect();
    node?.disconnect();
    processor.processedTrack?.stop();
    processor.processedTrack = undefined;
    const closing = context;
    const owns = ownsContext;
    source = node = destination = context = undefined;
    ownsContext = false;
    await closeContext(closing, owns);
  }

  return processor;
}
