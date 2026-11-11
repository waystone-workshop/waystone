import { setupBoards } from "./boards.js";
import model from "./canvas-model.cjs";
const {
  createCanvas,
  editCanvas,
  duplicateCanvas,
  validateCanvas,
  paintDrawing,
} = model;
export function setupCanvases({
  notify,
  onAttach,
  canAttach,
  onChange,
  saveChannelBoard,
}) {
  const $ = (id) => document.getElementById(id),
    objects = new Map();
  const pad = $("canvas"),
    ctx = pad.getContext("2d");
  let current = null,
    draft = null,
    dirty = false,
    activeStroke = null,
    undo = [],
    redo = [],
    busy = false;
  let imageCurrent = null;
  const previewCache = new Map();
  const activeChannelBoards = new Map();
  const reconcileVersions = new Map();
  const report = (error) => notify(error.message);
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (error) {
      report(error);
    }
  };
  function preview(object) {
    if (object.type === "image") return object.content.dataURL;
    if (object.type === "board") {
      const thumbnail = document.createElement("canvas");
      thumbnail.width = 600;
      thumbnail.height = 360;
      const context = thumbnail.getContext("2d");
      context.fillStyle = "#202721";
      context.fillRect(0, 0, 600, 360);
      context.fillStyle = "#d5ec9c";
      context.fillText?.("BOARD", 30, 65);
      context.fillText?.(
        object.content.items.length +
          " items · " +
          object.content.connectors.length +
          " relationships",
        30,
        110,
      );
      return thumbnail.toDataURL("image/png");
    }
    const key = object.id + ":" + object.revision;
    if (previewCache.has(key)) return previewCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 600;
    paintDrawing(canvas.getContext("2d"), object.content);
    const url = canvas.toDataURL("image/png");
    previewCache.set(key, url);
    return url;
  }
  function renderLibrary() {
    const items = [...objects.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    $("canvas-grid").replaceChildren(
      ...items.map((object) => {
        const button = document.createElement("button");
        button.className = "canvas-card";
        button.dataset.canvasId = object.id;
        const image = document.createElement("img");
        image.src = preview(object);
        image.alt = object.title;
        const title = document.createElement("strong");
        title.textContent = object.title;
        const meta = document.createElement("small");
        meta.textContent = `${object.type} · revision ${object.revision}`;
        button.append(image, title, meta);
        button.onclick = () => open(object.id);
        return button;
      }),
    );
    if (!items.length)
      $("canvas-grid").textContent =
        "Start with an image or a drawing. Everything here stays on this device.";
  }
  async function persist(object, { remote = false } = {}) {
    if (object.channel) {
      const active = activeChannelBoards.get(object.channel.server);
      if (!active?.has(object.id))
        throw new Error(
          "Reconnect to the owning channel before saving this board.",
        );
      if (!remote) {
        if (!saveChannelBoard)
          throw new Error(
            "Reconnect to the owning channel before saving this board.",
          );
        const resources = [
          ...new Set(
            object.content.items
              .filter((item) => item.kind === "canvas")
              .map((item) => item.canvasId),
          ),
        ].map((id) => objects.get(id));
        object = await saveChannelBoard(object, resources);
      }
      if (!activeChannelBoards.get(object.channel.server)?.has(object.id))
        throw new Error("The owning channel was deleted.");
    }
    const saved = validateCanvas(
      await window.waystone.saveCanvas(validateCanvas(object)),
    );
    objects.set(saved.id, saved);
    previewCache.clear();
    renderLibrary();
    onChange(saved);
    boards.refresh();
    return saved;
  }
  const boards = setupBoards({
    getObjects: () => [...objects.values()],
    getObject: (id) => objects.get(id),
    preview,
    persist,
    openCanvas: open,
    notify,
  });
  const ready = (async () => {
    try {
      const result = await window.waystone.listCanvases();
      for (const object of result.canvases) {
        const validated = validateCanvas(object);
        objects.set(validated.id, validated);
      }
      $("canvas-library-status").textContent = result.warnings.join(" ");
      renderLibrary();
      onChange();
    } catch (error) {
      $("canvas-library-status").textContent =
        "Could not load local Canvases. " + error.message;
    }
  })();
  function controls() {
    $("undo-drawing").disabled = !undo.length || busy;
    $("redo-drawing").disabled = !redo.length || busy;
    $("attach-drawing").disabled = !canAttach() || busy;
    for (const id of [
      "drawing-title",
      "save-drawing",
      "duplicate-drawing",
      "export-drawing",
      "clear-drawing",
    ])
      $(id).disabled = busy;
  }
  function checkpoint() {
    undo.push(structuredClone(draft.content.strokes));
    if (undo.length > 50) undo.shift();
    redo = [];
    dirty = true;
    controls();
  }
  function openDrawing(object = null) {
    current = object;
    draft = structuredClone(
      object ||
        createCanvas(
          "drawing",
          { width: 1000, height: 600, strokes: [] },
          "Untitled drawing",
        ),
    );
    dirty = !object;
    undo = [];
    redo = [];
    activeStroke = null;
    $("drawing-title").value = draft.title;
    $("drawing-canvas-id").textContent =
      `${draft.id} · ${object ? "revision " + object.revision : "not saved yet"}`;
    paintDrawing(ctx, draft.content);
    controls();
    $("drawing-dialog").showModal();
  }
  function open(id) {
    const object = objects.get(id);
    if (!object) return;
    if (object.type === "board") boards.open(object);
    else if (object.type === "drawing") openDrawing(object);
    else {
      imageCurrent = object;
      $("image-title").value = object.title;
      $("canvas-image").src = object.content.dataURL;
      $("image-canvas-id").textContent =
        `${object.id} · revision ${object.revision}`;
      $("attach-image").disabled = !canAttach();
      $("image-viewer").showModal();
    }
  }
  async function saveDrawing() {
    if (busy) throw new Error("Wait for the Canvas to finish saving.");
    if (activeStroke) finishStroke();
    busy = true;
    controls();
    try {
      const title = $("drawing-title").value;
      if (current && !dirty && title === current.title) return current;
      const object = current
        ? editCanvas(current, draft.content, title)
        : validateCanvas({ ...draft, title });
      current = await persist(object);
      draft = structuredClone(current);
      dirty = false;
      $("drawing-canvas-id").textContent =
        `${current.id} · revision ${current.revision}`;
      notify("Canvas saved locally.");
      return current;
    } finally {
      busy = false;
      controls();
    }
  }
  async function saveImage() {
    if (busy) throw new Error("Wait for saving to finish.");
    busy = true;
    $("image-title").disabled = true;
    try {
      const title = $("image-title").value;
      if (title !== imageCurrent.title)
        imageCurrent = await persist(
          editCanvas(imageCurrent, imageCurrent.content, title),
        );
      $("image-canvas-id").textContent =
        `${imageCurrent.id} · revision ${imageCurrent.revision}`;
      return imageCurrent;
    } finally {
      busy = false;
      $("image-title").disabled = false;
    }
  }
  function point(event) {
    const rect = pad.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(1000, ((event.clientX - rect.left) * 1000) / rect.width),
      ),
      Math.max(
        0,
        Math.min(600, ((event.clientY - rect.top) * 600) / rect.height),
      ),
    ];
  }
  pad.onpointerdown = (event) => {
    if (busy || activeStroke || event.button > 0) return;
    checkpoint();
    activeStroke = {
      color: $("ink").value,
      size: Number($("brush").value),
      points: [point(event)],
    };
    draft.content.strokes.push(activeStroke);
    pad.setPointerCapture(event.pointerId);
    paintDrawing(ctx, draft.content);
  };
  pad.onpointermove = (event) => {
    if (!activeStroke || busy) return;
    const p = point(event);
    if (activeStroke.points.length >= 10000) return;
    const last = activeStroke.points.at(-1);
    activeStroke.points.push(p);
    ctx.strokeStyle = activeStroke.color;
    ctx.lineWidth = activeStroke.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...p);
    ctx.stroke();
  };
  function finishStroke() {
    activeStroke = null;
    controls();
  }
  pad.onpointerup =
    pad.onpointercancel =
    pad.onlostpointercapture =
      finishStroke;
  $("drawing-title").oninput = () => {
    dirty = true;
  };
  $("clear-drawing").onclick = () => {
    if (!busy) {
      checkpoint();
      draft.content.strokes = [];
      paintDrawing(ctx, draft.content);
    }
  };
  $("undo-drawing").onclick = () => {
    if (!undo.length || busy) return;
    finishStroke();
    redo.push(structuredClone(draft.content.strokes));
    draft.content.strokes = undo.pop();
    dirty = true;
    paintDrawing(ctx, draft.content);
    controls();
  };
  $("redo-drawing").onclick = () => {
    if (!redo.length || busy) return;
    undo.push(structuredClone(draft.content.strokes));
    draft.content.strokes = redo.pop();
    dirty = true;
    paintDrawing(ctx, draft.content);
    controls();
  };
  $("save-drawing").onclick = run(saveDrawing);
  $("duplicate-drawing").onclick = run(async () => {
    const copy = await persist(duplicateCanvas(await saveDrawing()));
    current = copy;
    draft = structuredClone(copy);
    $("drawing-title").value = copy.title;
    dirty = false;
    notify("Independent copy created.");
  });
  $("export-drawing").onclick = run(async () => {
    if (await window.waystone.exportCanvas(await saveDrawing()))
      notify("Editable Canvas file saved.");
  });
  $("attach-drawing").onclick = run(async () => {
    const object = await saveDrawing();
    await onAttach(object, preview(object));
    $("drawing-dialog").close();
  });
  $("save-image").onclick = run(async () => {
    await saveImage();
    notify("Canvas saved locally.");
  });
  $("duplicate-image").onclick = run(async () => {
    imageCurrent = await persist(duplicateCanvas(await saveImage()));
    $("image-title").value = imageCurrent.title;
    $("image-canvas-id").textContent = imageCurrent.id;
    notify("Independent copy created.");
  });
  $("export-image").onclick = run(async () => {
    if (await window.waystone.exportCanvas(await saveImage()))
      notify("Canvas file saved.");
  });
  $("attach-image").onclick = run(async () => {
    const object = await saveImage();
    await onAttach(object, preview(object));
    $("image-viewer").close();
  });
  async function importImage(file) {
    if (
      file.size > 5 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        file.type,
      )
    )
      throw new Error("Choose a PNG, JPEG, GIF or WebP image up to 5 MB.");
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image."));
      reader.readAsDataURL(file);
    });
    return persist(
      createCanvas(
        "image",
        { dataURL },
        (file.name || "Untitled image").slice(0, 120),
      ),
    );
  }
  const showLibrary = run(async () => {
    await ready;
    renderLibrary();
    $("canvas-library").showModal();
  });
  $("workspace-canvases").onclick = showLibrary;
  $("new-canvas-drawing").onclick = $("draw").onclick = () => openDrawing();
  $("new-canvas-image").onclick = () => $("canvas-image-file").click();
  $("canvas-image-file").onchange = run(async () => {
    try {
      const file = $("canvas-image-file").files[0];
      if (file) open((await importImage(file)).id);
    } finally {
      $("canvas-image-file").value = "";
    }
  });
  $("import-canvas").onclick = run(async () => {
    let object = await window.waystone.importCanvas();
    if (!object) return;
    if (object.format === "waystone-board") {
      object = structuredClone(object);
      delete object.board.channel;
      let board = validateCanvas(object.board);
      const resources = object.canvases.map(validateCanvas);
      if (
        board.type !== "board" ||
        resources.some((resource) => resource.type === "board")
      )
        throw new Error("Invalid board file.");
      const conflicts = [board, ...resources].some(
        (resource) =>
          objects.has(resource.id) &&
          JSON.stringify(objects.get(resource.id)) !== JSON.stringify(resource),
      );
      const remap = new Map();
      if (conflicts) {
        if (
          !confirm(
            "This board has conflicting local objects. Import the board and its resources as independent copies?",
          )
        )
          return;
        for (const resource of [board, ...resources])
          remap.set(resource.id, crypto.randomUUID());
      }
      for (let resource of resources) {
        if (remap.has(resource.id))
          resource = createCanvas(
            resource.type,
            resource.content,
            resource.title,
            remap.get(resource.id),
          );
        await persist(resource);
      }
      const content = structuredClone(board.content);
      for (const item of content.items)
        if (item.kind === "canvas" && remap.has(item.canvasId))
          item.canvasId = remap.get(item.canvasId);
      if (remap.has(board.id))
        board = createCanvas(
          "board",
          content,
          board.title,
          remap.get(board.id),
        );
      open((await persist(board)).id);
      return;
    }
    if (object.channel) {
      object = { ...object };
      delete object.channel;
    }
    object = validateCanvas(object);
    const existing = objects.get(object.id);
    if (
      existing &&
      JSON.stringify(existing) !== JSON.stringify(object) &&
      existing.revision >= object.revision
    ) {
      if (
        !confirm(
          "A different version of this Canvas already exists. Import as an independent copy?",
        )
      )
        return;
      object = duplicateCanvas(object);
    }
    open((await persist(object)).id);
  });
  $("drawing-dialog").addEventListener("cancel", (event) => {
    if (busy || (dirty && !confirm("Discard the unsaved drawing changes?")))
      event.preventDefault();
  });
  $("drawing-dialog")
    .querySelector("[data-close]")
    .addEventListener(
      "click",
      (event) => {
        if (
          busy ||
          (dirty && !confirm("Discard the unsaved drawing changes?"))
        ) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      },
      true,
    );
  const imageDirty = () =>
    imageCurrent && $("image-title").value !== imageCurrent.title;
  $("image-viewer").addEventListener("cancel", (event) => {
    if (busy || (imageDirty() && !confirm("Discard the unsaved name change?")))
      event.preventDefault();
  });
  $("image-viewer")
    .querySelector("[data-close]")
    .addEventListener(
      "click",
      (event) => {
        if (
          busy ||
          (imageDirty() && !confirm("Discard the unsaved name change?"))
        ) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      },
      true,
    );
  window.addEventListener("beforeunload", (event) => {
    if (
      busy ||
      (dirty && $("drawing-dialog").open) ||
      (imageDirty() && $("image-viewer").open)
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  async function reconcileChannels(server, channels) {
    await ready;
    const version = (reconcileVersions.get(server) || 0) + 1;
    reconcileVersions.set(server, version);
    const ids = new Set(channels.map((channel) => channel.board_id));
    activeChannelBoards.set(server, ids);
    const removed = await window.waystone.pruneChannelBoards({
      server,
      boardIds: [...ids],
    });
    if (reconcileVersions.get(server) !== version) return;
    for (const id of removed) {
      objects.delete(id);
      boards.invalidate(id);
    }
    // Also invalidate an unsaved open board after deletion, even if no local file remains.
    for (const object of [...objects.values()])
      if (object.channel?.server === server && !ids.has(object.id)) {
        objects.delete(object.id);
        boards.invalidate(object.id);
      }
    renderLibrary();
  }
  async function openChannelBoard(bundle, owner) {
    await ready;
    for (const resource of bundle.canvases) {
      const current = objects.get(resource.id);
      if (!current || resource.revision > current.revision)
        await persist(validateCanvas(resource));
    }
    const object = validateCanvas({ ...bundle.board, channel: owner });
    const saved = await persist(object, { remote: true });
    boards.open(saved);
  }
  return {
    ready,
    get: (id) => objects.get(id),
    preview,
    open,
    importImage,
    reconcileChannels,
    openChannelBoard,
  };
}
