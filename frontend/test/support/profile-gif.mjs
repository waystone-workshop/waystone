// Two 1px frames (black, then white), with legal GIF comment blocks as padding.
export function animatedGif(bytes) {
  const frames = Buffer.from(
    "47494638396101000100800000000000ffffff" +
    "21ff0b4e45545343415045322e300301000000" +
    "21f904000a0000002c0000000001000100000202440100" +
    "21f904000a0000002c00000000010001000002024c0100", "hex");
  if (bytes < frames.length + 5) throw Error("Fixture size is too small");
  const chunks = [frames, Buffer.from([0x21, 0xfe])];
  let remaining = bytes - frames.length - 4;
  while (remaining) {
    let count = Math.min(255, remaining - 1);
    if (remaining - count - 1 === 1) count--;
    chunks.push(Buffer.from([count]), Buffer.alloc(count));
    remaining -= count + 1;
  }
  chunks.push(Buffer.from([0, 0x3b]));
  return Buffer.concat(chunks);
}
