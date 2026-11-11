import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JSDOM } from "jsdom";
import { expect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import model from "../src/canvas-model.cjs";
import storage from "../canvas-store.cjs";
import boardFiles from "../board-files.cjs";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const poll = (fn) => expect.poll(fn, { timeout: 5000 }).toBeTruthy();
test("offline board editor arranges references, connects ideas, undoes changes and exports/reopens a portable plan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "waystone-board-ui-")),
    store = new storage.CanvasStore(directory);
  const image = model.createCanvas(
    "image",
    { dataURL: "data:image/png;base64," + png },
    "UI reference",
  );
  await store.save(image);
  const existingBoard = model.createCanvas(
    "board",
    { items: [], connectors: [], view: { x: 60, y: 60, zoom: 1 } },
    "Existing board",
  );
  await store.save(existingBoard);
  let network = 0,
    exported = null,
    archive = null;
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    {
      url: "http://waystone.local",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window,
    $ = (id) => w.document.getElementById(id);
  w.structuredClone = structuredClone;
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    fillText() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  });
  w.HTMLCanvasElement.prototype.toDataURL = () =>
    `data:image/png;base64,${png}`;
  w.HTMLElement.prototype.setPointerCapture = () => {};
  $("board-surface").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });
  w.waystone = {
    listCanvases: () => store.list(),
    saveCanvas: (value) => store.save(value),
    exportCanvas: async (value) => {
      exported = structuredClone(value);
      return true;
    },
    importCanvas: async () => structuredClone(exported),
    exportBoardContext: async ({ bundle, previews }) => {
      archive = boardFiles.boardContext(bundle, previews);
      return true;
    },
    request: () => {
      network++;
      throw new Error("Offline");
    },
  };
  function pointer(target, type, x = 100, y = 100, extra = {}) {
    target.dispatchEvent(
      new w.MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  }
  function clickItem(id, extra = {}) {
    const target = $("board-world").querySelector(`[data-item-id="${id}"]`);
    pointer(target, "pointerdown", 100, 100, extra);
    pointer($("board-surface"), "pointerup");
  }
  const nodes = () => $("board-world").querySelectorAll("[data-item-id]");
  const latest = async () =>
    (await store.list()).canvases.find((c) => c.type === "board");
  async function save() {
    $("board-save").click();
    await poll(
      () =>
        !$("board-save").disabled &&
        $("board-status").textContent === "Saved locally",
    );
    return latest();
  }
  try {
    w.eval(await readFile(new URL("../dist/app.js", import.meta.url), "utf8"));
    $("workspace-canvases").click();
    await poll(() => $("canvas-library").open);
    $("canvas-grid")
      .querySelector(`[data-canvas-id="${existingBoard.id}"]`)
      .click();
    await poll(() => $("board-dialog").open);
    $("board-title").value = "Release brainstorm";
    $("board-title").dispatchEvent(new w.Event("input"));
    $("board-add-note").click();
    const note = nodes()[0].dataset.itemId;
    $("board-item-text").value = "Ship image canvases";
    $("board-item-text").dispatchEvent(new w.Event("change"));
    $("board-add-text").click();
    const text = nodes()[1].dataset.itemId;
    $("board-item-text").value = "Acceptance criteria";
    $("board-item-text").dispatchEvent(new w.Event("change"));
    $("board-add-canvas").click();
    $("board-canvas-picker").querySelector("button").click();
    assert.equal(nodes().length, 3);
    const placement = nodes()[2].dataset.itemId;
    $("board-duplicate").click();
    assert.equal(nodes().length, 4);
    $("board-undo").click();
    assert.equal(nodes().length, 3);
    $("board-redo").click();
    assert.equal(nodes().length, 4);
    $("board-connect").click();
    clickItem(note);
    clickItem(text);
    assert.equal($("board-world").querySelectorAll("[data-edge-id]").length, 1);
    pointer(
      $("board-world").querySelector("[data-edge-id] line"),
      "pointerdown",
    );
    $("board-edge-label").value = "needs";
    $("board-edge-label").dispatchEvent(new w.Event("change"));
    const before = await save();
    assert.equal(
      before.content.items.filter((i) => i.canvasId === image.id).length,
      2,
    );
    assert.equal(before.content.connectors[0].label, "needs");
    clickItem(note);
    clickItem(text, { shiftKey: true });
    assert.equal($("board-selection-status").textContent, "2 selected");
    pointer(
      $("board-world").querySelector(`[data-item-id="${note}"]`),
      "pointerdown",
      100,
      100,
    );
    pointer($("board-surface"), "pointermove", 180, 150);
    pointer($("board-surface"), "pointerup", 180, 150);
    const moved = await save();
    for (const id of [note, text]) {
      const a = before.content.items.find((i) => i.id === id),
        b = moved.content.items.find((i) => i.id === id);
      assert.equal(b.x, a.x + 80);
      assert.equal(b.y, a.y + 50);
    }
    pointer($("board-surface"), "pointerdown", 0, 0);
    pointer($("board-surface"), "pointerup", 0, 0);
    clickItem(note);
    const handle = $("board-world").querySelector("[data-resize]");
    pointer(handle, "pointerdown", 100, 100);
    pointer($("board-surface"), "pointermove", 140, 130);
    pointer($("board-surface"), "pointerup", 140, 130);
    $("board-item-rotation").value = "15";
    $("board-item-rotation").dispatchEvent(new w.Event("change"));
    const resized = await save();
    assert.equal(resized.content.items.find((i) => i.id === note).width, 280);
    assert.equal(resized.content.items.find((i) => i.id === note).rotation, 15);
    $("board-zoom-in").click();
    assert.equal($("board-zoom").textContent, "120%");
    $("board-pan").click();
    pointer($("board-surface"), "pointerdown", 100, 100);
    pointer($("board-surface"), "pointermove", 130, 140);
    pointer($("board-surface"), "pointerup");
    $("board-pan").click();
    await save();
    $("board-export-file").click();
    await poll(() => !!exported);
    assert.equal(exported.format, "waystone-board");
    assert.equal(exported.canvases.length, 1);
    $("board-export-context").click();
    await poll(() => $("board-context-dialog").open);
    assert.match($("board-plan-preview").textContent, /Ship image canvases/);
    $("board-save-context").click();
    await poll(() => !!archive);
    const zipped = unzipSync(archive);
    assert.match(strFromU8(zipped["plan.md"]), /needs/);
    assert.ok(zipped[`attachments/${image.id}.png`]);
    $("board-context-dialog").close();
    const boardId = exported.board.id;
    $("board-close").click();
    $("canvas-grid").querySelector(`[data-canvas-id="${boardId}"]`).click();
    assert.equal(nodes().length, 4);
    assert.equal($("board-title").value, "Release brainstorm");
    $("board-close").click();
    $("import-canvas").click();
    await poll(() => $("board-dialog").open);
    assert.equal(nodes().length, 4);
    assert.equal(
      (await store.list()).canvases.filter((c) => c.type === "board").length,
      1,
    );
    assert.equal(network, 0);
    // A conflicting file import forks the graph instead of replacing local objects.
    $("board-close").click();
    exported = {
      ...exported,
      board: { ...exported.board, title: "Conflicting imported plan" },
    };
    $("import-canvas").click();
    await poll(
      () =>
        $("board-dialog").open &&
        $("board-title").value === "Conflicting imported plan",
    );
    const importedBoards = (await store.list()).canvases.filter(
      (c) => c.type === "board",
    );
    assert.equal(importedBoards.length, 2);
    const fork = importedBoards.find((c) => c.id !== boardId);
    assert.ok(
      fork.content.items
        .filter((i) => i.kind === "canvas")
        .every((i) => i.canvasId !== image.id),
    );
    assert.equal(
      importedBoards.find((c) => c.id === boardId).title,
      "Release brainstorm",
    );
    const source = (await store.list()).canvases.find((c) => c.id === image.id);
    assert.deepEqual(source, image);
  } finally {
    dom.window.close();
    await rm(directory, { recursive: true, force: true });
  }
});
