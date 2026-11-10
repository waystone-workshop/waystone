import model from "./canvas-model.cjs";
import boardModel from "./board-model.cjs";
const { createCanvas, editCanvas, validateCanvas } = model;
const {
  emptyBoard,
  newItem,
  screenToWorld,
  zoomAt,
  removeItems,
  duplicateItems,
  planMarkdown,
  COLORS,
} = boardModel;
export function setupBoards({
  getObjects,
  getObject,
  preview,
  persist,
  openCanvas,
  notify,
}) {
  const $ = (id) => document.getElementById(id),
    surface = $("board-surface"),
    world = $("board-world");
  let original,
    draft,
    dirty = false,
    busy = false,
    selection = new Set(),
    edgeSelection = null,
    history = [],
    future = [],
    gesture = null,
    mode = "select",
    connectFrom = null,
    space = false;
  const svgNS = "http://www.w3.org/2000/svg";
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const tell = (text) => {
    $("board-feedback").textContent = text;
    notify(text);
  };
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (error) {
      tell(error.message);
    }
  };
  const snapshot = () => structuredClone(draft);
  function checkpoint() {
    history.push(snapshot());
    if (history.length > 60) history.shift();
    future = [];
    dirty = true;
  }
  function bounds(item) {
    const angle = (item.rotation * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const points = [
      [0, 0],
      [item.width, 0],
      [0, item.height],
      [item.width, item.height],
    ].map(([x, y]) => ({
      x: item.x + x * c - y * s,
      y: item.y + x * s + y * c,
    }));
    return {
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    };
  }
  function center(item) {
    const a = (item.rotation * Math.PI) / 180;
    return {
      x:
        item.x +
        (item.width / 2) * Math.cos(a) -
        (item.height / 2) * Math.sin(a),
      y:
        item.y +
        (item.width / 2) * Math.sin(a) +
        (item.height / 2) * Math.cos(a),
    };
  }
  function controls() {
    $("board-undo").disabled = !history.length || busy;
    $("board-redo").disabled = !future.length || busy;
    $("board-save").disabled = busy;
    $("board-title").disabled = busy;
    for (const id of [
      "board-item-text",
      "board-item-color",
      "board-item-rotation",
      "board-edge-label",
    ])
      $(id).disabled = busy;
    $("board-status").textContent = busy
      ? "Saving…"
      : dirty
        ? "Unsaved changes"
        : "Saved locally";
    $("board-zoom").textContent =
      Math.round(draft.content.view.zoom * 100) + "%";
    $("board-selection-status").textContent = edgeSelection
      ? "Connector selected"
      : `${selection.size} selected`;
    $("board-mode").textContent =
      mode === "connect"
        ? connectFrom
          ? "Choose the target item"
          : "Choose the source item"
        : mode === "pan"
          ? "Pan tool"
          : "Select tool";
    $("board-pan").classList.toggle("active", mode === "pan");
    $("board-connect").classList.toggle("active", mode === "connect");
  }
  function renderInspector() {
    const item = draft.content.items.find((i) => selection.has(i.id));
    $("board-item-controls").hidden = selection.size !== 1 || !item;
    $("board-edge-controls").hidden = !edgeSelection;
    if (selection.size === 1 && item) {
      $("board-text-label").hidden = item.kind === "canvas";
      $("board-item-text").value = item.text || "";
      $("board-item-color").value = item.color || COLORS[0];
      $("board-color-label").hidden = item.kind === "canvas";
      $("board-item-rotation").value = item.rotation;
      $("board-open-canvas").hidden = item.kind !== "canvas";
      $("board-canvas-info").textContent =
        item.kind === "canvas"
          ? `Canvas: ${item.canvasId}`
          : "Board-owned " + item.kind;
    }
    const edge = draft.content.connectors.find((e) => e.id === edgeSelection);
    if (edge) $("board-edge-label").value = edge.label;
  }
  function render(inspect = true) {
    if (!draft) return;
    const view = draft.content.view;
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    const edges = svg("svg", {
        class: "board-edges",
        "aria-label": "Relationships",
      }),
      defs = svg("defs"),
      marker = svg("marker", {
        id: "board-arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      });
    marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#91a878" }));
    defs.append(marker);
    edges.append(defs);
    for (const edge of draft.content.connectors) {
      const a = draft.content.items.find((i) => i.id === edge.from),
        b = draft.content.items.find((i) => i.id === edge.to);
      if (!a || !b) continue;
      const start = center(a),
        end = center(b),
        group = svg("g", {
          "data-edge-id": edge.id,
          class: edge.id === edgeSelection ? "selected" : "",
        });
      // Rectangles cover the line through each item; the arrow ends at the target boundary.
      const dx = end.x - start.x,
        dy = end.y - start.y,
        angle = (-b.rotation * Math.PI) / 180;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle),
        localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      const factor = Math.min(
        b.width / 2 / Math.max(Math.abs(localX), 0.001),
        b.height / 2 / Math.max(Math.abs(localY), 0.001),
        1,
      );
      const tip = { x: end.x - dx * factor, y: end.y - dy * factor };
      group.append(
        svg("line", {
          x1: start.x,
          y1: start.y,
          x2: tip.x,
          y2: tip.y,
          "marker-end": "url(#board-arrow)",
        }),
      );
      const label = svg("text", {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - 9,
        "text-anchor": "middle",
      });
      label.textContent = edge.label || "relationship";
      group.append(label);
      edges.append(group);
    }
    const nodes = draft.content.items
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((item) => {
        const element = node("div");
        element.className = `board-item board-${item.kind}${selection.has(item.id) ? " selected" : ""}`;
        element.dataset.itemId = item.id;
        element.tabIndex = 0;
        element.setAttribute("role", "group");
        element.style.left = item.x + "px";
        element.style.top = item.y + "px";
        element.style.width = item.width + "px";
        element.style.height = item.height + "px";
        element.style.transform = `rotate(${item.rotation}deg)`;
        element.style.zIndex = String(item.z + 1);
        if (item.kind === "canvas") {
          const object = getObject(item.canvasId),
            image = node("img");
          image.draggable = false;
          image.alt = object?.title || "Missing Canvas";
          if (object) image.src = preview(object);
          const title = node("small", object?.title || "Missing Canvas");
          element.append(image, title);
          element.ondblclick = () => {
            if (object) openCanvas(object.id);
          };
          element.setAttribute("aria-label", image.alt);
        } else {
          element.style.backgroundColor =
            item.kind === "note" ? item.color : "transparent";
          const text = node("div", item.text);
          text.className = "board-note-content";
          element.append(text);
          element.setAttribute(
            "aria-label",
            item.kind + ": " + item.text.slice(0, 80),
          );
          element.ondblclick = () => {
            selection = new Set([item.id]);
            edgeSelection = null;
            render();
            $("board-item-text").focus();
          };
        }
        if (selection.size === 1 && selection.has(item.id)) {
          const handle = node("button");
          handle.className = "board-resize";
          handle.dataset.resize = item.id;
          handle.title = "Resize item";
          handle.setAttribute("aria-label", "Resize item");
          element.append(handle);
        }
        return element;
      });
    world.replaceChildren(edges, ...nodes);
    controls();
    if (inspect) renderInspector();
  }
  function point(event) {
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function setView(view) {
    if (busy) return;
    draft.content.view = {
      ...view,
      x: Math.max(-1e6, Math.min(1e6, view.x)),
      y: Math.max(-1e6, Math.min(1e6, view.y)),
    };
    dirty = true;
    render(false);
  }
  function open(object = null) {
    original = object;
    draft = snapshotObject(
      object || createCanvas("board", emptyBoard(), "Untitled board"),
    );
    dirty = !object;
    selection.clear();
    edgeSelection = null;
    history = [];
    future = [];
    gesture = null;
    mode = "select";
    connectFrom = null;
    $("board-title").value = draft.title;
    $("board-feedback").textContent = "";
    render();
    const dialog = $("board-dialog");
    const workspace = $("workspace");
    const embedded = Boolean(object?.channel && workspace && !workspace.hidden);
    dialog.classList.toggle("is-embedded", embedded);
    if (embedded) document.querySelector(".conversation").append(dialog);
    if (embedded && typeof dialog.show === "function") dialog.show(); else dialog.showModal();
    document.dispatchEvent(new CustomEvent("waystone-board-view", { detail: { open: true, embedded } }));
  }
  const snapshotObject = (value) => structuredClone(value);
  async function save() {
    if (busy || gesture)
      throw new Error("Finish the current action before saving.");
    busy = true;
    controls();
    try {
      const title = $("board-title").value;
      if (!dirty && original && title === original.title) return original;
      const value = original
        ? editCanvas(original, draft.content, title)
        : { ...draft, title };
      const saved = await persist(value);
      if (!draft) throw new Error("The owning channel was deleted.");
      original = saved;
      draft = structuredClone(original);
      dirty = false;
      tell("Board saved locally.");
      return original;
    } finally {
      busy = false;
      render();
    }
  }
  function add(kind, canvasId) {
    if (busy) return;
    checkpoint();
    const rect = surface.getBoundingClientRect();
    const view = draft.content.view;
    const columns = Math.max(
      1,
      Math.floor(((rect.width || 800) - 60) / (340 * view.zoom)),
    );
    const index = draft.content.items.length;
    const anchor = screenToWorld({ x: 40, y: 40 }, view);
    const p = {
      x: anchor.x + (index % columns) * 340,
      y: anchor.y + Math.floor(index / columns) * 240,
    };
    const item = newItem(kind, p.x, p.y, canvasId);
    item.z = Math.max(0, ...draft.content.items.map((i) => i.z)) + 1;
    draft.content.items.push(item);
    if ((p.y + item.height) * view.zoom + view.y > (rect.height || 500) - 30) {
      draft.content.view = { ...view, y: 40 - p.y * view.zoom };
    }
    selection = new Set([item.id]);
    edgeSelection = null;
    render();
  }
  function chooseItem(id, event) {
    if (mode === "connect") {
      if (!connectFrom) {
        connectFrom = id;
        selection = new Set([id]);
        render();
        return;
      }
      if (connectFrom !== id) {
        checkpoint();
        draft.content.connectors.push({
          id: crypto.randomUUID(),
          from: connectFrom,
          to: id,
          label: "",
        });
        connectFrom = null;
        mode = "select";
        selection.clear();
        render();
      }
      return;
    }
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      selection.has(id) ? selection.delete(id) : selection.add(id);
    } else if (!selection.has(id)) selection = new Set([id]);
    edgeSelection = null;
  }
  surface.onpointerdown = (event) => {
    if (busy || event.button > 1) return;
    surface.focus({ preventScroll: true });
    const local = point(event),
      p = screenToWorld(local, draft.content.view),
      itemNode = event.target.closest("[data-item-id]"),
      edge = event.target.closest("[data-edge-id]");
    if (event.button === 1 || space || mode === "pan") {
      gesture = { kind: "pan", start: local, view: { ...draft.content.view } };
      surface.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (edge) {
      edgeSelection = edge.dataset.edgeId;
      selection.clear();
      render();
      return;
    }
    if (itemNode) {
      const id = itemNode.dataset.itemId,
        wasConnecting = mode === "connect";
      if (!event.target.closest("[data-resize]")) chooseItem(id, event);
      if (wasConnecting || !selection.has(id)) {
        render();
        return;
      }
      gesture = {
        kind: event.target.closest("[data-resize]") ? "resize" : "move",
        start: p,
        before: snapshot(),
        items: structuredClone(
          draft.content.items.filter((i) => selection.has(i.id)),
        ),
        changed: false,
      };
      surface.setPointerCapture(event.pointerId);
      render();
      event.preventDefault();
      return;
    }
    edgeSelection = null;
    if (!event.shiftKey) selection.clear();
    gesture = {
      kind: "marquee",
      start: p,
      add: event.shiftKey ? new Set(selection) : new Set(),
    };
    surface.setPointerCapture(event.pointerId);
    render();
  };
  surface.onpointermove = (event) => {
    if (!gesture) return;
    const local = point(event),
      p = screenToWorld(local, draft.content.view);
    if (gesture.kind === "pan") {
      setView({
        ...gesture.view,
        x: gesture.view.x + local.x - gesture.start.x,
        y: gesture.view.y + local.y - gesture.start.y,
      });
      return;
    }
    if (gesture.kind === "marquee") {
      const left = Math.min(p.x, gesture.start.x),
        top = Math.min(p.y, gesture.start.y),
        right = Math.max(p.x, gesture.start.x),
        bottom = Math.max(p.y, gesture.start.y);
      selection = new Set(gesture.add);
      for (const item of draft.content.items) {
        const b = bounds(item);
        if (
          b.right >= left &&
          b.left <= right &&
          b.bottom >= top &&
          b.top <= bottom
        )
          selection.add(item.id);
      }
      render(false);
      const box = node("div");
      box.className = "board-marquee";
      box.style.left = left + "px";
      box.style.top = top + "px";
      box.style.width = right - left + "px";
      box.style.height = bottom - top + "px";
      world.append(box);
      return;
    }
    const dx = p.x - gesture.start.x,
      dy = p.y - gesture.start.y;
    for (const before of gesture.items) {
      const item = draft.content.items.find((i) => i.id === before.id);
      if (gesture.kind === "move") {
        item.x = Math.max(-1e6, Math.min(1e6, before.x + dx));
        item.y = Math.max(-1e6, Math.min(1e6, before.y + dy));
      } else {
        const a = (-before.rotation * Math.PI) / 180;
        item.width = Math.max(
          60,
          Math.min(10000, before.width + dx * Math.cos(a) - dy * Math.sin(a)),
        );
        item.height = Math.max(
          40,
          Math.min(10000, before.height + dx * Math.sin(a) + dy * Math.cos(a)),
        );
      }
    }
    gesture.changed = gesture.changed || dx !== 0 || dy !== 0;
    render(false);
  };
  function finish(cancel = false) {
    if (!gesture) return;
    if (["move", "resize"].includes(gesture.kind) && gesture.changed) {
      if (cancel) draft = gesture.before;
      else {
        history.push(gesture.before);
        if (history.length > 60) history.shift();
        future = [];
        dirty = true;
      }
    }
    gesture = null;
    render();
  }
  surface.onpointerup = () => finish();
  surface.onpointercancel = () => finish(true);
  surface.onlostpointercapture = () => finish();
  surface.addEventListener(
    "wheel",
    (event) => {
      if (!draft || busy) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey)
        setView(
          zoomAt(
            draft.content.view,
            point(event),
            draft.content.view.zoom * Math.exp(-event.deltaY * 0.005),
          ),
        );
      else
        setView({
          ...draft.content.view,
          x: draft.content.view.x - event.deltaX,
          y: draft.content.view.y - event.deltaY,
        });
    },
    { passive: false },
  );
  function zoom(factor) {
    const r = surface.getBoundingClientRect();
    setView(
      zoomAt(
        draft.content.view,
        { x: r.width / 2, y: r.height / 2 },
        draft.content.view.zoom * factor,
      ),
    );
  }
  function undo() {
    if (!history.length || busy) return;
    future.push(snapshot());
    const view = draft.content.view;
    draft = history.pop();
    draft.content.view = view;
    dirty = true;
    selection.clear();
    edgeSelection = null;
    render();
  }
  function redo() {
    if (!future.length || busy) return;
    history.push(snapshot());
    const view = draft.content.view;
    draft = future.pop();
    draft.content.view = view;
    dirty = true;
    selection.clear();
    edgeSelection = null;
    render();
  }
  function remove() {
    if ((!selection.size && !edgeSelection) || busy) return;
    checkpoint();
    draft.content = removeItems(draft.content, selection);
    draft.content.connectors = draft.content.connectors.filter(
      (e) => e.id !== edgeSelection,
    );
    selection.clear();
    edgeSelection = null;
    render();
  }
  function duplicate() {
    if (!selection.size || busy) return;
    checkpoint();
    const result = duplicateItems(draft.content, selection);
    draft.content = result.content;
    selection = new Set(result.ids);
    render();
  }
  $("board-add-note").onclick = () => add("note");
  $("board-add-text").onclick = () => add("text");
  $("board-add-canvas").onclick = () => {
    $("board-canvas-picker").replaceChildren(
      ...getObjects()
        .filter((o) => o.type === "image" || o.type === "drawing")
        .map((object) => {
          const button = node("button", object.title);
          button.dataset.canvasId = object.id;
          button.onclick = () => {
            add("canvas", object.id);
            $("board-picker-dialog").close();
          };
          return button;
        }),
    );
    if (!$("board-canvas-picker").children.length)
      $("board-canvas-picker").textContent =
        "Add an image or drawing to your Canvas library first.";
    $("board-picker-dialog").showModal();
  };
  $("board-title").oninput = () => {
    draft.title = $("board-title").value;
    dirty = true;
    controls();
  };
  function changeSelected(change) {
    if (busy) return;
    const item = draft.content.items.find((i) => selection.has(i.id));
    if (!item || selection.size !== 1) return;
    checkpoint();
    change(item);
    render();
  }
  $("board-item-text").onchange = () =>
    changeSelected((item) => (item.text = $("board-item-text").value));
  $("board-item-color").onchange = () =>
    changeSelected((item) => (item.color = $("board-item-color").value));
  $("board-item-rotation").onchange = () =>
    changeSelected((item) => {
      const value = Number($("board-item-rotation").value);
      item.rotation = Number.isFinite(value)
        ? Math.max(-360, Math.min(360, value))
        : 0;
    });
  $("board-edge-label").onchange = () => {
    const edge = draft.content.connectors.find((e) => e.id === edgeSelection);
    if (edge && !busy) {
      checkpoint();
      edge.label = $("board-edge-label").value;
      render();
    }
  };
  $("board-open-canvas").onclick = () => {
    const item = draft.content.items.find((i) => selection.has(i.id));
    if (item?.canvasId) openCanvas(item.canvasId);
  };
  $("board-front").onclick = () =>
    changeSelected(
      (item) =>
        (item.z = Math.min(
          100000,
          Math.max(...draft.content.items.map((i) => i.z)) + 1,
        )),
    );
  $("board-duplicate").onclick = duplicate;
  $("board-delete").onclick = remove;
  $("board-undo").onclick = undo;
  $("board-redo").onclick = redo;
  $("board-pan").onclick = () => {
    mode = mode === "pan" ? "select" : "pan";
    connectFrom = null;
    render();
  };
  $("board-connect").onclick = () => {
    mode = mode === "connect" ? "select" : "connect";
    connectFrom = null;
    render();
  };
  $("board-zoom-in").onclick = () => zoom(1.2);
  $("board-zoom-out").onclick = () => zoom(1 / 1.2);
  $("board-fit").onclick = () => {
    if (!draft.content.items.length) {
      setView({ x: 60, y: 60, zoom: 1 });
      return;
    }
    const all = draft.content.items.map(bounds),
      left = Math.min(...all.map((b) => b.left)),
      right = Math.max(...all.map((b) => b.right)),
      top = Math.min(...all.map((b) => b.top)),
      bottom = Math.max(...all.map((b) => b.bottom)),
      r = surface.getBoundingClientRect();
    const zoom = Math.max(
      0.1,
      Math.min(
        2,
        (r.width - 100) / (right - left),
        (r.height - 100) / (bottom - top),
      ),
    );
    setView({
      x: r.width / 2 - ((left + right) / 2) * zoom,
      y: r.height / 2 - ((top + bottom) / 2) * zoom,
      zoom,
    });
  };
  function exportDocument() {
    if (draft.channel)
      return Promise.resolve(
        validateCanvas({ ...draft, title: $("board-title").value }),
      );
    return save();
  }
  function bundle(board) {
    const ids = new Set(
      board.content.items
        .filter((i) => i.kind === "canvas")
        .map((i) => i.canvasId),
    );
    const canvases = [...ids].map((id) => {
      const object = getObject(id);
      if (!object || object.type === "board")
        throw new Error("A referenced Canvas is missing or unsupported.");
      return object;
    });
    return {
      format: "waystone-board",
      version: 1,
      board: Object.fromEntries(
        Object.entries(board).filter(([key]) => key !== "channel"),
      ),
      canvases,
    };
  }
  $("board-save").onclick = run(save);
  $("board-export-file").onclick = run(async () => {
    if (await window.waystone.exportCanvas(bundle(await exportDocument())))
      tell("Board file saved with its Canvas resources.");
  });
  $("board-export-context").onclick = run(async () => {
    const value = bundle(await exportDocument());
    $("board-plan-preview").textContent = planMarkdown(
      value.board,
      value.canvases,
    );
    $("board-context-dialog").showModal();
    $("board-save-context").onclick = run(async () => {
      const previews = {};
      for (const object of value.canvases)
        if (object.type === "drawing") previews[object.id] = preview(object);
      if (await window.waystone.exportBoardContext({ bundle: value, previews }))
        tell("Plan and attachments exported.");
    });
  });
  function allowClose() {
    return !busy && (!dirty || confirm("Discard the unsaved board changes?"));
  }
  $("board-dialog").addEventListener("cancel", (event) => {
    if (!allowClose()) event.preventDefault();
  });
  $("board-close").addEventListener(
    "click",
    (event) => {
      if (!allowClose()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener("beforeunload", (event) => {
    if ($("board-dialog").open && (dirty || busy)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      !$("board-dialog").open ||
      [...document.querySelectorAll("dialog[open]")].some(
        (dialog) => !["board-dialog", "canvas-library"].includes(dialog.id),
      ) ||
      event.target.closest("input,textarea,select")
    )
      return;
    if (event.code === "Space") {
      space = true;
      event.preventDefault();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicate();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") space = false;
  });
  window.addEventListener("blur", () => {
    space = false;
    finish(true);
  });
  return {
    open,
    invalidate: (id) => {
      if (draft?.id !== id) return;
      $("board-context-dialog").close();
      $("board-picker-dialog").close();
      $("board-dialog").close();
      draft = null;
      original = null;
      dirty = false;
      gesture = null;
    },
    refresh: () => {
      if ($("board-dialog").open) render();
    },
  };
}
