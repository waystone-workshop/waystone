import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { expect } from "@playwright/test";
import storeModule from "../canvas-store.cjs";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const poll = (fn) => expect.poll(fn, { timeout: 5000 }).toBeTruthy();
test("Canvases work offline: save, reopen, edit, undo/redo, duplicate, file round-trip and image import", async () => {
  const directory = await mkdtemp(join(tmpdir(), "waystone-offline-"));
  const store = new storeModule.CanvasStore(directory);
  let network = 0,
    exported = null;
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const bundle = await readFile(
    new URL("../dist/app.js", import.meta.url),
    "utf8",
  );
  const windows = [];
  async function launch() {
    const dom = new JSDOM(html, {
      url: "http://waystone.local",
      runScripts: "outside-only",
    });
    windows.push(dom);
    const w = dom.window;
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
      beginPath() {},
      arc() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    });
    w.HTMLCanvasElement.prototype.toDataURL = () =>
      `data:image/png;base64,${png}`;
    w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
    w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
    });
    w.waystone = {
      listCanvases: () => store.list(),
      saveCanvas: (value) => store.save(value),
      exportCanvas: async (value) => {
        exported = JSON.parse(JSON.stringify(value));
        return true;
      },
      importCanvas: async () => structuredClone(exported),
      request: () => {
        network++;
        throw new Error("Network must not be used");
      },
    };
    w.eval(bundle);
    const $ = (id) => w.document.getElementById(id);
    $("local-canvases").click();
    await poll(() => $("canvas-library").open);
    return { w, $ };
  }
  try {
    const { w, $ } = await launch();
    $("new-canvas-drawing").click();
    $("drawing-title").value = "Design sketch";
    $("drawing-title").dispatchEvent(new w.Event("input"));
    for (const [type, x, y] of [
      ["pointerdown", 20, 20],
      ["pointermove", 80, 80],
      ["pointerup", 80, 80],
    ])
      $("canvas").dispatchEvent(
        new w.MouseEvent(type, { clientX: x, clientY: y }),
      );
    $("undo-drawing").click();
    $("save-drawing").click();
    await poll(() => !$("save-drawing").disabled);
    assert.equal((await store.list()).canvases[0].content.strokes.length, 0);
    $("redo-drawing").click();
    $("save-drawing").click();
    await poll(() => !$("save-drawing").disabled);
    const original = (await store.list()).canvases[0];
    assert.equal(original.content.strokes.length, 1);
    assert.equal(original.revision, 2);
    $("drawing-dialog").close();
    $("canvas-grid").querySelector("button").click();
    assert.equal($("drawing-title").value, "Design sketch");
    $("drawing-title").value = "Renamed sketch";
    $("drawing-title").dispatchEvent(new w.Event("input"));
    $("save-drawing").click();
    await poll(() => !$("save-drawing").disabled);
    assert.equal((await store.list()).canvases[0].id, original.id);
    $("duplicate-drawing").click();
    await poll(() => $("drawing-title").value === "Renamed sketch copy");
    assert.equal((await store.list()).canvases.length, 2);
    $("export-drawing").click();
    await poll(() => !!exported);
    assert.equal(exported.type, "drawing");
    assert.equal(exported.content.strokes.length, 1);
    $("drawing-dialog").close();
    $("import-canvas").click();
    await poll(() => $("drawing-dialog").open);
    assert.equal((await store.list()).canvases.length, 2);
    const restarted = await launch();
    assert.equal(
      restarted.$("canvas-grid").querySelectorAll(".canvas-card").length,
      2,
    );
    const file = new restarted.w.File(
      [Buffer.from(png, "base64")],
      "Reference.png",
      { type: "image/png" },
    );
    Object.defineProperty(restarted.$("canvas-image-file"), "files", {
      value: [file],
    });
    restarted
      .$("canvas-image-file")
      .dispatchEvent(new restarted.w.Event("change"));
    await poll(() => restarted.$("image-viewer").open);
    const images = (await store.list()).canvases.filter(
      (c) => c.type === "image",
    );
    assert.equal(images.length, 1);
    assert.equal(images[0].content.dataURL, `data:image/png;base64,${png}`);
    assert.equal(network, 0);
    assert.equal(restarted.$("attach-image").disabled, true);
  } finally {
    for (const window of windows) window.window.close();
    await rm(directory, { recursive: true, force: true });
  }
});
