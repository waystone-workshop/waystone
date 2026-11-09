const { validateCanvas } = require("./src/canvas-model.cjs");
const { planMarkdown } = require("./src/board-model.cjs");
function validateBundle(value) {
  if (
    !value ||
    value.format !== "waystone-board" ||
    value.version !== 1 ||
    !Array.isArray(value.canvases) ||
    value.canvases.length > 1000
  )
    throw new Error("Invalid board file.");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 128 * 1024 * 1024)
    throw new Error("Board file is too large (128 MB maximum).");
  const board = validateCanvas(value.board);
  if (board.type !== "board") throw new Error("Expected a board.");
  const canvases = value.canvases.map(validateCanvas),
    ids = new Set();
  for (const canvas of canvases) {
    if (canvas.type === "board" || canvas.id === board.id || ids.has(canvas.id))
      throw new Error("Invalid board resources.");
    ids.add(canvas.id);
  }
  for (const item of board.content.items)
    if (item.kind === "canvas" && !ids.has(item.canvasId))
      throw new Error("A referenced Canvas is missing.");
  return { format: "waystone-board", version: 1, board, canvases };
}
function zipFiles(files) {
  const { zipSync } = require("fflate");
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        files.map(([name, data]) => [
          name,
          Buffer.isBuffer(data) ? data : Buffer.from(data),
        ]),
      ),
      { level: 0 },
    ),
  );
}
function boardContext(bundle, previews) {
  const valid = validateBundle(bundle),
    files = [
      ["plan.md", planMarkdown(valid.board, valid.canvases)],
      ["board.canvas.json", JSON.stringify(valid, null, 2)],
    ];
  for (const canvas of valid.canvases) {
    let dataURL =
      canvas.type === "image" ? canvas.content.dataURL : previews[canvas.id];
    const image = validateCanvas({
      ...canvas,
      type: "image",
      content: { dataURL },
    });
    if (
      canvas.type === "drawing" &&
      !image.content.dataURL.startsWith("data:image/png;")
    )
      throw new Error("Expected a PNG drawing preview.");
    const extension = dataURL
      .match(/^data:image\/(\w+)/)[1]
      .replace("jpeg", "jpg");
    files.push([
      `attachments/${canvas.id}.${extension}`,
      Buffer.from(dataURL.split(",")[1], "base64"),
    ]);
  }
  if (
    files.reduce((total, [, data]) => total + Buffer.byteLength(data), 0) >
    128 * 1024 * 1024
  )
    throw new Error("Board context is too large (128 MB maximum).");
  return zipFiles(files);
}
module.exports = { validateBundle, boardContext, zipFiles };
