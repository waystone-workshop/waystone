const { validateBoard } = require("./board-model.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;
function validateCanvas(value) {
  const fail = () => {
    throw new Error(
      "Invalid Canvas file. Expected a Waystone image, drawing or board.",
    );
  };
  if (
    !value ||
    JSON.stringify(value).length > MAX_BYTES ||
    value.version !== 1 ||
    !UUID.test(value.id) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.title !== "string" ||
    value.title.length > 120 ||
    !value.title.trim() ||
    !["image", "drawing", "board"].includes(value.type)
  )
    fail();
  if (
    ![value.createdAt, value.updatedAt].every(
      (date) => typeof date === "string" && Number.isFinite(Date.parse(date)),
    )
  )
    fail();
  const result = {
    version: 1,
    id: value.id.toLowerCase(),
    revision: value.revision,
    type: value.type,
    title: value.title.trim(),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  if (value.channel !== undefined) {
    if (
      value.type !== "board" ||
      !value.channel ||
      !Number.isSafeInteger(value.channel.id) ||
      value.channel.id < 1 ||
      typeof value.channel.server !== "string"
    )
      fail();
    let origin;
    try {
      origin = new URL(value.channel.server);
    } catch {
      fail();
    }
    if (
      origin.origin !== value.channel.server ||
      origin.username ||
      origin.password ||
      !["https:", "http:"].includes(origin.protocol) ||
      (origin.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
      fail();
    result.channel = { server: origin.origin, id: value.channel.id };
  }
  if (value.type === "image") {
    if (
      typeof value.content?.dataURL !== "string" ||
      !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        value.content.dataURL,
      ) ||
      value.content.dataURL.length > 7_000_000
    )
      fail();
    result.content = { dataURL: value.content.dataURL };
  } else if (value.type === "board") {
    result.content = validateBoard(value.content);
    if (
      result.content.items.some(
        (item) => item.kind === "canvas" && item.canvasId === result.id,
      )
    )
      fail();
  } else {
    const c = value.content;
    if (
      !c ||
      c.width !== 1000 ||
      c.height !== 600 ||
      !Array.isArray(c.strokes) ||
      c.strokes.length > 10000
    )
      fail();
    let count = 0;
    const strokes = c.strokes.map((stroke) => {
      if (
        !/^#[0-9a-f]{6}$/i.test(stroke.color) ||
        !Number.isFinite(stroke.size) ||
        stroke.size < 1 ||
        stroke.size > 30 ||
        !Array.isArray(stroke.points) ||
        !stroke.points.length
      )
        fail();
      count += stroke.points.length;
      if (count > 100000) fail();
      return {
        color: stroke.color,
        size: stroke.size,
        points: stroke.points.map((point) => {
          if (
            !Array.isArray(point) ||
            point.length !== 2 ||
            !point.every(Number.isFinite) ||
            point[0] < 0 ||
            point[0] > 1000 ||
            point[1] < 0 ||
            point[1] > 600
          )
            fail();
          return [...point];
        }),
      };
    });
    result.content = { width: 1000, height: 600, strokes };
  }
  return result;
}
function createCanvas(
  type,
  content,
  title = "Untitled canvas",
  id = globalThis.crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  return validateCanvas({
    version: 1,
    id,
    revision: 1,
    type,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  });
}
function editCanvas(canvas, content, title = canvas.title) {
  return validateCanvas({
    ...canvas,
    content,
    title,
    revision: canvas.revision + 1,
    updatedAt: new Date().toISOString(),
  });
}
function duplicateCanvas(canvas, id = globalThis.crypto.randomUUID()) {
  return createCanvas(
    canvas.type,
    canvas.content,
    `${canvas.title.slice(0, 110)} copy`,
    id,
  );
}
function paintDrawing(ctx, content) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, content.width, content.height);
  for (const stroke of content.strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const [first, ...rest] = stroke.points;
    ctx.beginPath();
    ctx.arc(first[0], first[1], stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(...first);
    for (const point of rest) ctx.lineTo(...point);
    ctx.stroke();
  }
}
module.exports = {
  validateCanvas,
  createCanvas,
  editCanvas,
  duplicateCanvas,
  paintDrawing,
  MAX_BYTES,
  UUID,
};
