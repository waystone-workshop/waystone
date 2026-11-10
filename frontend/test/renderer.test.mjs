import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import WebSocket from "ws";
import { expect } from "@playwright/test";
import { startBackend } from "./support/backend.mjs";

test("renderer sends text, pictures and drawings, exports a range, and restores local drafts", async () => {
  const backend = await startBackend();
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "http://waystone.local",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    $ = (id) => w.document.getElementById(id),
    saved = [],
    copied = [],
    strokes = [];
  const sockets = [];
  w.WebSocket = class extends WebSocket {
    constructor(...args) {
      super(...args);
      sockets.push(this);
    }
  };
  w.TextEncoder = TextEncoder;
  w.structuredClone = structuredClone;
  w.confirm = () => true;
  w.URL.createObjectURL = () => "blob:waystone-test";
  w.URL.revokeObjectURL = () => {};
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
    lineTo(...args) {
      strokes.push(args);
    },
    stroke() {},
  });
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  w.HTMLCanvasElement.prototype.toBlob = function (callback) {
    callback(new w.Blob([backend.png], { type: "image/png" }));
  };
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 600,
  });
  const canvasObjects = new Map();
  w.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/png;base64," + backend.png.toString("base64");
  w.waystone = {
    listCanvases: async () => ({ canvases: [], warnings: [] }),
    pruneChannelBoards: async ({ server, boardIds }) => {
      const removed = [];
      for (const [id, object] of canvasObjects)
        if (object.channel?.server === server && !boardIds.includes(id)) {
          removed.push(id);
          canvasObjects.delete(id);
        }
      return removed;
    },
    saveCanvas: async (object) => {
      canvasObjects.set(object.id, structuredClone(object));
      return object;
    },
    exportCanvas: async (value) => {
      saved.push(value);
      return true;
    },
    importCanvas: async () => null,
    request: async ({ server, path, token, body, method, binary }) => {
      const response = await fetch(server + path, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      return binary
        ? new Uint8Array(await response.arrayBuffer())
        : response.json();
    },
    copyContext: async (text) => copied.push(text),
    saveExport: async (data) => {
      saved.push(data);
      return true;
    },
  };
  const submit = (id) =>
    $(id).dispatchEvent(
      new w.SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: $(id).querySelector("button:not([type=button])"),
      }),
    );
  const change = (id) =>
    $(id).dispatchEvent(new w.Event("change", { bubbles: true }));
  const poll = async (fn) => expect.poll(fn, { timeout: 5000 }).toBeTruthy();
  try {
    w.eval(await readFile(new URL("../dist/app.js", import.meta.url), "utf8"));
    $("server").value = backend.origin;
    $("name").value = "Ada";
    $("password").value = "test-password-long";
    submit("join-form");
    await poll(
      () =>
        !$("workspace").hidden &&
        $("messages").textContent.includes("Let’s plan"),
    );
    $("body").value = '<script>alert("text only")</script>';
    submit("composer");
    await poll(() => $("messages").querySelectorAll("article").length === 2);
    assert.equal($("messages").querySelectorAll("script").length, 0);
    assert.match($("messages").textContent, /<script>/);
    const file = new w.File([backend.png], "image.png", { type: "image/png" });
    Object.defineProperty($("files"), "files", {
      value: [file],
      configurable: true,
    });
    change("files");
    await poll(() => $("pending").querySelectorAll("img").length === 1);
    submit("composer");
    await poll(
      () =>
        $("messages").querySelectorAll("article").length === 3 &&
        !$("send").disabled,
    );
    $("draw").click();
    assert.equal($("drawing-dialog").open, true);
    $("canvas").dispatchEvent(
      new w.MouseEvent("pointerdown", { clientX: 20, clientY: 20 }),
    );
    $("canvas").dispatchEvent(
      new w.MouseEvent("pointermove", { clientX: 80, clientY: 80 }),
    );
    $("canvas").dispatchEvent(new w.MouseEvent("pointerup"));
    assert.deepEqual(strokes, [[80, 80]]);
    $("attach-drawing").click();
    await poll(() => $("pending").querySelectorAll("img").length === 1);
    submit("composer");
    await poll(
      () =>
        $("messages").querySelectorAll("article").length === 4 &&
        !$("send").disabled,
    );
    await poll(() => $("messages").querySelectorAll("img[src]").length === 2);
    const checks = $("messages").querySelectorAll("input");
    checks[0].click();
    checks[3].click();
    $("export-open").click();
    await poll(() => $("export-preview").textContent.includes("# Waystone"));
    assert.ok(backend.requests.some((path) => path.includes("from=1&to=4")));
    $("copy-context").click();
    await poll(() => copied.length === 1);
    $("save-markdown").click();
    await poll(() => saved.length === 1);
    assert.equal(saved[0].name, "general.md");
    assert.match(new TextDecoder().decode(saved[0].bytes), /Grace/);
    $("export-scope").value = "all";
    change("export-scope");
    await poll(() => !$("save-bundle").disabled);
    $("save-bundle").click();
    await poll(() => saved.length === 2);
    assert.equal(saved[1].name, "general.zip");
    assert.deepEqual(Array.from(saved[1].bytes.slice(0, 4)), [80, 75, 5, 6]);
    assert.ok(
      backend.requests.some((path) => path.includes("format=zip&to=4")),
    );
    $("export-dialog").close();
    $("body").value = "Keep this draft";
    $("body").dispatchEvent(new w.Event("input"));
    $("channel-name").value = "planning";
    submit("channel-form");
    await poll(() => $("channel-title").textContent === "Planning");
    assert.equal($("body").value, "");
    $("channels").querySelector("button").click();
    await poll(() => $("body").value === "Keep this draft");
    $("open-channel-board").click();
    await poll(() => $("board-dialog").open);
    $("board-add-note").click();
    $("board-item-text").value = "Shared planning";
    $("board-item-text").dispatchEvent(new w.Event("change"));
    $("board-save").click();
    await poll(
      () =>
        !$("board-save").disabled &&
        $("board-status").textContent === "Saved locally",
    );
    const owned = [...canvasObjects.values()].find(
      (object) => object.channel?.id === 1,
    );
    assert.equal(owned.revision, 2);
    assert.equal(owned.content.items[0].text, "Shared planning");
    const { channel: owner, ...remoteBoard } = owned;
    await fetch(backend.origin + "/api/channels/1/board", {
      method: "PUT",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        board: { ...remoteBoard, title: "Another client plan" },
        canvases: [],
        base_revision: 2,
      }),
    });
    $("board-item-text").value = "Keep this unsaved idea";
    $("board-item-text").dispatchEvent(new w.Event("change"));
    $("board-save").click();
    await poll(() => $("board-feedback").textContent.includes("Board changed"));
    assert.equal(canvasObjects.get(owned.id).revision, 2);
    $("board-export-file").click();
    await poll(() => saved.some((item) => item.format === "waystone-board"));
    const rescued = saved.find((item) => item.format === "waystone-board");
    assert.equal(rescued.board.content.items[0].text, "Keep this unsaved idea");
    assert.equal(rescued.board.channel, undefined);
    const resourceIds = [...canvasObjects.values()]
      .filter((object) => object.type !== "board")
      .map((object) => object.id);
    // Simulate another member deleting the open channel.
    await fetch(backend.origin + "/api/channels/1", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });
    await poll(
      () =>
        $("channel-title").textContent === "Planning" &&
        !$("board-dialog").open,
    );
    assert.equal(canvasObjects.has(owned.id), false);
    assert.ok(resourceIds.every((id) => canvasObjects.has(id)));
    $("open-channel-board").click();
    await poll(() => $("board-dialog").open);
    $("board-close").click();
    $("delete-channel").click();
    await poll(
      () => $("channel-title").textContent === "Choose or create a channel",
    );
    assert.equal(
      [...canvasObjects.values()].some((object) => object.channel),
      false,
    );
    assert.equal($("open-channel-board").disabled, true);
    assert.equal(
      JSON.parse(w.localStorage.getItem("waystone-preferences")).name,
      "ada",
    );
  } finally {
    $("leave").click();
    await poll(() => $("workspace").hidden);
    await Promise.all(
      sockets.map((socket) =>
        socket.readyState === WebSocket.CLOSED
          ? Promise.resolve()
          : new Promise((resolve) => {
              socket.once("close", resolve);
              socket.close();
            }),
      ),
    );
    await backend.close();
    dom.window.close();
  }
});
