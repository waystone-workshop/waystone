import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import model from "../src/canvas-model.cjs";
import board from "../src/board-model.cjs";
import files from "../board-files.cjs";
import storage from "../canvas-store.cjs";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function fixture() {
  const image = model.createCanvas(
    "image",
    { dataURL: "data:image/png;base64," + png },
    "Reference",
  );
  const a = board.newItem("note", 10, 20),
    b = board.newItem("canvas", 400, 50, image.id);
  a.text = "Build the next release";
  const content = {
    ...board.emptyBoard(),
    items: [a, b],
    connectors: [
      { id: crypto.randomUUID(), from: a.id, to: b.id, label: "inspired by" },
    ],
  };
  const document = model.createCanvas("board", content, "Release plan");
  return {
    image,
    a,
    b,
    document,
    bundle: {
      format: "waystone-board",
      version: 1,
      board: document,
      canvases: [image],
    },
  };
}
test("zoom keeps the point under the cursor fixed", () => {
  const view = { x: 40, y: -20, zoom: 0.8 },
    point = { x: 250, y: 200 };
  const next = board.zoomAt(view, point, 1.5);
  assert.deepEqual(
    board.screenToWorld(point, next),
    board.screenToWorld(point, view),
  );
  assert.equal(board.zoomAt(view, point, 100).zoom, 4);
});
test("placements reuse source identity and removing nodes cleans their connectors", () => {
  const { document, b } = fixture();
  const result = board.duplicateItems(document.content, new Set([b.id]));
  assert.equal(result.content.items.at(-1).canvasId, b.canvasId);
  assert.notEqual(result.content.items.at(-1).id, b.id);
  assert.equal(
    board.removeItems(document.content, new Set([b.id])).connectors.length,
    0,
  );
});
test("board validation rejects broken edges, duplicate identities, invalid geometry and self references", () => {
  const { document, a } = fixture();
  for (const content of [
    {
      ...document.content,
      connectors: [
        {
          id: crypto.randomUUID(),
          from: a.id,
          to: crypto.randomUUID(),
          label: "",
        },
      ],
    },
    { ...document.content, items: [a, a] },
    { ...document.content, items: [{ ...a, width: Infinity }] },
  ])
    assert.throws(() => model.validateCanvas({ ...document, content }));
  assert.throws(() =>
    model.validateCanvas({
      ...document,
      content: {
        ...document.content,
        items: [board.newItem("canvas", 0, 0, document.id)],
        connectors: [],
      },
    }),
  );
});
test("portable context contains text, relationships, original image bytes and editable board resources", () => {
  const { bundle, image, a, b } = fixture();
  const archive = unzipSync(files.boardContext(bundle, {}));
  const plan = strFromU8(archive["plan.md"]);
  assert.match(plan, /Build the next release/);
  assert.ok(plan.includes(`${a.id} → ${b.id}: inspired by`));
  assert.equal(
    Buffer.from(archive[`attachments/${image.id}.png`]).toString("base64"),
    png,
  );
  assert.deepEqual(
    files.validateBundle(JSON.parse(strFromU8(archive["board.canvas.json"]))),
    bundle,
  );
  assert.throws(() => files.validateBundle({ ...bundle, canvases: [] }));
});
test("boards persist references without copying or modifying source objects; nested boards are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waystone-board-"));
  try {
    const store = new storage.CanvasStore(dir),
      { image, document } = fixture();
    await store.save(image);
    await store.save(document);
    const loaded = (await new storage.CanvasStore(dir).list()).canvases;
    assert.deepEqual(
      loaded.find((c) => c.id === image.id),
      image,
    );
    assert.deepEqual(
      loaded.find((c) => c.id === document.id),
      document,
    );
    const nested = model.createCanvas("board", {
      ...board.emptyBoard(),
      items: [board.newItem("canvas", 0, 0, document.id)],
    });
    await assert.rejects(() => store.save(nested), /Nested/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drawing context exports both a PNG preview and the original editable strokes", () => {
  const drawing = model.createCanvas(
    "drawing",
    {
      width: 1000,
      height: 600,
      strokes: [
        {
          color: "#112233",
          size: 4,
          points: [
            [10, 20],
            [50, 60],
          ],
        },
      ],
    },
    "Sketch",
  );
  const document = model.createCanvas(
    "board",
    {
      ...board.emptyBoard(),
      items: [board.newItem("canvas", 10, 20, drawing.id)],
    },
    "Drawing plan",
  );
  const bundle = {
    format: "waystone-board",
    version: 1,
    board: document,
    canvases: [drawing],
  };
  const zipped = unzipSync(
    files.boardContext(bundle, {
      [drawing.id]: "data:image/png;base64," + png,
    }),
  );
  assert.equal(
    Buffer.from(zipped[`attachments/${drawing.id}.png`]).toString("base64"),
    png,
  );
  assert.deepEqual(
    JSON.parse(strFromU8(zipped["board.canvas.json"])).canvases[0].content,
    drawing.content,
  );
  assert.throws(() => files.boardContext(bundle, {}));
});

test("channel-board cache cleanup deletes only owned boards and blocks late saves after deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waystone-owned-board-"));
  try {
    const store = new storage.CanvasStore(dir),
      { image, document } = fixture();
    const standalone = model.createCanvas(
      "board",
      board.emptyBoard(),
      "Independent",
    );
    const owned = model.validateCanvas({
      ...document,
      channel: { server: "https://mars.example.com", id: 7 },
    });
    await store.save(image);
    await store.save(standalone);
    await store.save(owned);
    assert.deepEqual(
      await store.pruneChannelBoards("https://other.example.com", []),
      [],
    );
    assert.deepEqual(
      await store.pruneChannelBoards("https://mars.example.com", [owned.id]),
      [],
    );
    assert.deepEqual(
      await store.pruneChannelBoards("https://mars.example.com", []),
      [owned.id],
    );
    const ids = (await store.list()).canvases.map((c) => c.id);
    assert.ok(ids.includes(image.id));
    assert.ok(ids.includes(standalone.id));
    assert.ok(!ids.includes(owned.id));
    await assert.rejects(
      () => store.save(model.editCanvas(owned, owned.content)),
      /deleted/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("ownership is retained by edits, omitted by duplicates and cannot be detached in place", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waystone-board-owner-"));
  try {
    const object = model.validateCanvas({
      ...model.createCanvas("board", board.emptyBoard()),
      channel: { server: "https://mars.example.com", id: 1 },
    });
    assert.deepEqual(
      model.editCanvas(object, object.content).channel,
      object.channel,
    );
    assert.equal(model.duplicateCanvas(object).channel, undefined);
    assert.throws(() =>
      model.validateCanvas({
        ...object,
        channel: { server: "file:///etc", id: 1 },
      }),
    );
    const store = new storage.CanvasStore(dir);
    await store.save(object);
    const detached = model.editCanvas(object, object.content);
    delete detached.channel;
    await assert.rejects(() => store.save(detached), /detached/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
