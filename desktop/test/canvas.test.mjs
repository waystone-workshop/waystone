import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import model from "../src/canvas-model.cjs";
import storeModule from "../canvas-store.cjs";
const { createCanvas, editCanvas, duplicateCanvas, validateCanvas } = model;
const content = {
  width: 1000,
  height: 600,
  strokes: [
    {
      color: "#112233",
      size: 4,
      points: [
        [1, 2],
        [100, 200],
      ],
    },
  ],
};
test("drawing edits retain identity while duplicates are independent editable documents", () => {
  const original = createCanvas("drawing", content, "Architecture");
  const edited = editCanvas(original, { ...content, strokes: [] });
  assert.equal(edited.id, original.id);
  assert.equal(edited.revision, 2);
  assert.equal(original.content.strokes.length, 1);
  const copy = duplicateCanvas(original);
  assert.notEqual(copy.id, original.id);
  copy.content.strokes[0].points[0][0] = 99;
  assert.equal(original.content.strokes[0].points[0][0], 1);
  assert.deepEqual(
    validateCanvas(JSON.parse(JSON.stringify(original))),
    original,
  );
});
test("invalid and unsupported Canvas imports are rejected", () => {
  const object = createCanvas("drawing", content);
  for (const invalid of [
    { ...object, id: "../../secret" },
    { ...object, type: "webpage" },
    { ...object, revision: 0 },
    {
      ...object,
      content: {
        ...content,
        strokes: [{ color: "red", size: 1, points: [[1, 2]] }],
      },
    },
    {
      ...object,
      content: {
        ...content,
        strokes: [{ color: "#112233", size: 1, points: [[Infinity, 2]] }],
      },
    },
  ])
    assert.throws(() => validateCanvas(invalid));
  assert.throws(() =>
    createCanvas("image", { dataURL: "https://tracker.example/image.png" }),
  );
});
test("Canvas library survives reopening, rejects stale writes, and keeps corrupt files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "waystone-canvas-"));
  try {
    const store = new storeModule.CanvasStore(directory),
      original = createCanvas("drawing", content);
    await store.save(original);
    const edited = editCanvas(original, { ...content, strokes: [] });
    await store.save(edited);
    const reopened = new storeModule.CanvasStore(directory);
    assert.deepEqual((await reopened.list()).canvases, [edited]);
    await assert.rejects(() => reopened.save(original), /revision/);
    await writeFile(join(directory, "broken.json"), "not json");
    const loaded = await reopened.list();
    assert.equal(loaded.warnings.length, 1);
    assert.equal(loaded.canvases.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
