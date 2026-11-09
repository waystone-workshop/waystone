import policy from "../policy.cjs";
import { setupCanvases } from "./canvases.js";
import { Socket } from "phoenix";
import { Room, RoomEvent } from "livekit-client";
import { AudioCall } from "./audio.mjs";
import { setupUpdates } from "./updates.mjs";
import { mergeMessages, rangeQuery } from "./context.mjs";
const $ = (id) => document.getElementById(id);
let server,
  token,
  name,
  socket,
  subscription,
  channelId,
  channelName,
  channelBoardId,
  messages = [],
  pending = [],
  selected = new Set(),
  generation = 0;
const imageCache = new Map();
let channelListVersion = 0;
let exportSnapshot = null;
let preview = "",
  exportVersion = 0,
  exporting = false,
  sending = false,
  imageUrls = [];
const stored = JSON.parse(localStorage.getItem("waystone-preferences") || "{}");
$("server").value = stored.server || process.env.WAYSTONE_SERVER_URL;
$("name").value = stored.name || "";
function notify(text) {
  $("notice").textContent = text;
}
function report(error) {
  notify(
    error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
  );
}
setupUpdates(window.waystone, document, report);
const api = (path, options = {}) =>
  window.waystone.request({ server, token, path: "/api" + path, ...options });
const call = new AudioCall({
  createRoom: () => new Room({
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: { audioPreset: { maxBitrate: 32000 }, dtx: true, red: true },
  }),
  events: RoomEvent,
  credentials: (id) => api(`/channels/${id}/call`, { method: "POST" }),
  audioHost: $("call-audio"),
  failed: report,
  changed: ({ state, muted, deafened, participants, playbackBlocked }) => {
    const idle = state === "idle";
    $("join-audio").hidden = !idle;
    $("join-audio").disabled = !channelId;
    $("call-panel").hidden = idle;
    $("call-state").textContent = state === "joining" ? "Connecting audio…"
      : state === "reconnecting" ? "Reconnecting audio…" : "Audio connected";
    $("call-channel").textContent = channelName ? `# ${channelName}` : "";
    $("call-mute").textContent = muted ? "Unmute" : "Mute mic";
    $("call-mute").setAttribute("aria-pressed", String(muted));
    $("call-mute").disabled = state !== "connected";
    $("call-deafen").textContent = deafened ? "Enable sound" : "Deafen";
    $("call-deafen").setAttribute("aria-pressed", String(deafened));
    $("call-resume").hidden = !playbackBlocked;
    $("call-participants").replaceChildren(...participants.map((person) => {
      const item = el("li", `${person.name}${person.self ? " (you)" : ""}${person.muted ? " · muted" : ""}`);
      item.classList.toggle("speaking", Boolean(person.speaking));
      return item;
    }));
  },
});
$("join-audio").onclick = () => { if (channelId) call.join(channelId); };
$("call-leave").onclick = () => call.leave();
$("call-mute").onclick = () => call.mute();
$("call-deafen").onclick = () => call.deafen();
$("call-resume").onclick = () => call.resume();
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function draftKey() {
  return `draft:${server}:${name}:${channelId}`;
}
function saveDraft() {
  if (channelId) localStorage.setItem(draftKey(), $("body").value);
}
$("body").addEventListener("input", () => {
  saveDraft();
  $("draft-status").textContent = "Draft saved locally";
});
$("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter || $("join-form").querySelector("button");
  button.disabled = true;
  try {
    server = policy.validateServer($("server").value.trim());
    const result = await api("/session", {
      body: { name: $("name").value, invite_code: $("invite").value },
    });
    token = result.token;
    name = result.name;
    $("invite").value = "";
    localStorage.setItem(
      "waystone-preferences",
      JSON.stringify({ server, name }),
    );
    $("identity").textContent = name;
    socket = new Socket(server.replace(/^http/, "ws") + "/socket", {
      params: { token },
    });
    socket.onOpen(() => {
      $("connection").textContent = "Connected";
    });
    socket.onClose(() => {
      $("connection").textContent = "Reconnecting…";
    });
    socket.onError(() => {
      $("connection").textContent = "Connection interrupted";
    });
    socket.connect();
    await loadChannels();
    const directory = socket.channel("directory", {});
    directory.on("channel_created", () => loadChannels().catch(report));
    directory.on("channel_deleted", () => loadChannels().catch(report));
    directory.on("board_updated", (event) => {
      if (event.channel_id === channelId)
        notify(
          "The channel board was updated. Open it again to load the latest saved version.",
        );
    });
    directory.join().receive("ok", () => loadChannels().catch(report));
    $("join").hidden = true;
    $("workspace").hidden = false;
    notify("");
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
});
async function loadChannels() {
  const listVersion = ++channelListVersion;
  const sessionToken = token;
  const result = await api("/channels");
  if (!token || token !== sessionToken || listVersion !== channelListVersion)
    return;
  await canvases.reconcileChannels(server, result.channels);
  if (!token || token !== sessionToken || listVersion !== channelListVersion)
    return;
  if (
    channelId &&
    !result.channels.some((channel) => channel.id === channelId)
  ) {
    localStorage.removeItem(draftKey());
    resetChannel();
  }
  $("channels").replaceChildren(
    ...result.channels.map((channel) => {
      const button = el("button", "#  " + channel.name);
      button.dataset.id = channel.id;
      button.onclick = () => switchChannel(channel).catch(report);
      return button;
    }),
  );
  if (!channelId && result.channels.length)
    await switchChannel(result.channels[0]);
}
function resetChannel() {
  call.leave();
  subscription?.leave();
  subscription = null;
  generation++;
  channelId = null;
  $("join-audio").disabled = true;
  channelName = null;
  channelBoardId = null;
  messages = [];
  pending = [];
  selected.clear();
  $("body").value = "";
  $("channel-title").textContent = "Choose or create a channel";
  for (const id of [
    "open-channel-board",
    "delete-channel",
    "send",
    "export-open",
  ])
    $(id).disabled = true;
  imageUrls.forEach((url) => URL.revokeObjectURL(url));
  imageUrls = [];
  imageCache.clear();
  renderMessages();
  renderPending();
}
$("open-channel-board").onclick = async () => {
  const id = channelId,
    version = generation;
  if (!id) return;
  const button = $("open-channel-board");
  button.disabled = true;
  try {
    const bundle = await api(`/channels/${id}/board`);
    if (generation !== version) return;
    if (bundle.board.id !== channelBoardId)
      throw new Error(
        "Channel board identity changed. Reload the channel list.",
      );
    await canvases.openChannelBoard(bundle, { server, id });
  } catch (error) {
    report(error);
  } finally {
    button.disabled = !channelId;
  }
};
$("delete-channel").onclick = async () => {
  if (!channelId || sending) return;
  if (
    !confirm(
      `Delete #${channelName}, its board and all its messages? This cannot be undone. Reusable images and drawings will be kept.`,
    )
  )
    return;
  const id = channelId;
  $("delete-channel").disabled = true;
  try {
    await api(`/channels/${id}`, { method: "DELETE" });
    await loadChannels();
    notify("Channel and its board deleted.");
  } catch (error) {
    report(error);
  } finally {
    $("delete-channel").disabled = !channelId;
  }
};
async function switchChannel(channel) {
  if (sending) return notify("Wait for your message to finish sending.");
  if (
    pending.length &&
    !confirm(
      "Discard the unsent attachments and switch channels? Your text draft will be kept.",
    )
  )
    return;
  saveDraft();
  call.leave();
  subscription?.leave();
  generation++;
  const version = generation;
  imageUrls.forEach((url) => URL.revokeObjectURL(url));
  imageUrls = [];
  imageCache.clear();
  channelId = channel.id;
  channelName = channel.name;
  $("join-audio").disabled = false;
  channelBoardId = channel.board_id;
  $("open-channel-board").disabled = false;
  $("delete-channel").disabled = false;
  $("send").disabled = false;
  $("export-open").disabled = false;
  messages = [];
  selected.clear();
  pending = [];
  $("body").value = localStorage.getItem(draftKey()) || "";
  renderPending();
  $("channel-title").textContent = "# " + channel.name;
  $("channels")
    .querySelectorAll("button")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.id) === channelId,
      ),
    );
  renderMessages();
  subscription = socket.channel(`chat:${channelId}`, {});
  subscription.on("message", (message) => {
    if (version !== generation) return;
    messages = mergeMessages(messages, [message]);
    renderMessages();
  });
  // Every successful join, including a reconnect, reloads history. Older loaded history is kept.
  subscription
    .join()
    .receive("ok", async () => {
      try {
        let before,
          collected = [];
        const newest = messages.at(-1)?.id;
        do {
          const result = await api(
            `/channels/${channel.id}/messages${before ? "?before=" + before : ""}`,
          );
          if (version !== generation) return;
          collected = mergeMessages(collected, result.messages);
          before = result.messages[0]?.id;
          if (!newest || result.messages.length < 100 || before <= newest)
            break;
        } while (before);
        messages = mergeMessages(messages, collected);
        renderMessages();
        $("older").hidden = !before || collected.length < 100;
      } catch (error) {
        report(error);
      }
    })
    .receive("error", () =>
      notify(
        "Could not join the channel. Join again if your session has expired.",
      ),
    );
}
function renderMessages() {
  const list = $("messages"),
    nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  if (!messages.length) {
    list.replaceChildren(
      el("div", "A fresh page. Start the conversation.", "empty"),
    );
    return;
  }
  const version = generation;
  list.replaceChildren(
    ...messages.map((message) => {
      const row = el(
        "article",
        undefined,
        message.author === name ? "message mine" : "message",
      );
      row.dataset.id = message.id;
      const check = el("input");
      check.type = "checkbox";
      check.checked = selected.has(message.id);
      check.setAttribute(
        "aria-label",
        `Select message ${message.id} for export`,
      );
      check.onchange = () => {
        check.checked ? selected.add(message.id) : selected.delete(message.id);
      };
      const content = el("div", undefined, "message-content");
      const meta = el("div", undefined, "meta");
      meta.append(
        el("strong", message.author),
        el("time", new Date(message.inserted_at).toLocaleString()),
        el("span", "#" + message.id),
      );
      content.append(meta, el("p", message.body));
      for (const attachment of message.attachments) {
        const image = el("img");
        image.alt =
          attachment.kind === "drawing" ? "Shared drawing" : "Shared picture";
        image.loading = "lazy";
        const local = canvases.get(attachment.canvas_id);
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute(
          "aria-label",
          local ? "Open Canvas: " + local.title : "View shared image",
        );
        const open = () => {
          if (local) canvases.open(local.id);
          else {
            $("shared-image").src = image.src;
            $("shared-image-viewer").showModal();
          }
        };
        image.onclick = open;
        image.onkeydown = (event) => {
          if (event.key === "Enter") open();
        };
        const load = async () => {
          try {
            if (local) {
              image.src = canvases.preview(local);
              return;
            }
            if (imageCache.has(attachment.id)) {
              image.src = imageCache.get(attachment.id);
              return;
            }
            const bytes = await api(
              `/messages/${message.id}/attachments/${attachment.id}`,
              { binary: true },
            );
            if (version !== generation || !image.isConnected) return;
            const url = URL.createObjectURL(
              new Blob([bytes], { type: attachment.content_type }),
            );
            imageUrls.push(url);
            imageCache.set(attachment.id, url);
            image.src = url;
          } catch {
            image.alt = "Image unavailable — reconnect and reload the channel.";
          }
        };
        content.append(image);
        queueMicrotask(load);
      }
      row.append(check, content);
      return row;
    }),
  );
  if (nearBottom) list.scrollTop = list.scrollHeight;
}
$("older").onclick = async () => {
  const version = generation,
    oldHeight = $("messages").scrollHeight;
  try {
    const result = await api(
      `/channels/${channelId}/messages?before=${messages[0].id}`,
    );
    if (version !== generation) return;
    messages = mergeMessages(messages, result.messages);
    renderMessages();
    $("older").hidden = result.messages.length < 100;
    $("messages").scrollTop += $("messages").scrollHeight - oldHeight;
  } catch (error) {
    report(error);
  }
};
$("add-channel").onclick = () => $("channel-dialog").showModal();
$("channel-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const channel = await api("/channels", {
      body: { name: $("channel-name").value },
    });
    await loadChannels();
    await switchChannel(channel);
    $("channel-dialog").close();
    $("channel-form").reset();
  } catch (error) {
    report(error);
  }
};
$("composer").onsubmit = async (event) => {
  event.preventDefault();
  if (!channelId || sending) return;
  sending = true;
  $("send").disabled = true;
  $("body").disabled = true;
  const text = $("body").value;
  const sendVersion = generation;
  try {
    const message = await api(`/channels/${channelId}/messages`, {
      body: {
        body: text,
        attachments: pending.map((attachment) => {
          const object = canvases.get(attachment.canvas_id);
          if (!object) return attachment;
          const dataURL = canvases.preview(object);
          return {
            ...attachment,
            data: dataURL.split(",")[1],
            canvas_revision: object.revision,
          };
        }),
      },
    });
    if (sendVersion !== generation) return;
    messages = mergeMessages(messages, [message]);
    pending = [];
    renderPending();
    $("body").value = "";
    saveDraft();
    $("draft-status").textContent = "";
    renderMessages();
    $("messages").scrollTop = $("messages").scrollHeight;
    notify("");
  } catch (error) {
    report(error);
  } finally {
    sending = false;
    $("send").disabled = !channelId;
    $("body").disabled = false;
    $("body").focus();
  }
};
$("body").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
};
function renderPending() {
  $("pending").replaceChildren(
    ...pending.map((attachment, index) => {
      const wrapper = el("div", undefined, "pending-image");
      const image = el("img");
      const object = canvases.get(attachment.canvas_id);
      image.src = object
        ? canvases.preview(object)
        : `data:${attachment.content_type};base64,${attachment.data}`;
      image.onclick = () => {
        if (object) canvases.open(object.id);
      };
      image.alt = attachment.kind;
      const remove = el("button", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove attachment");
      remove.onclick = () => {
        if (!sending) {
          pending.splice(index, 1);
          renderPending();
        }
      };
      wrapper.append(image, remove);
      return wrapper;
    }),
  );
}
async function attachCanvas(object, dataURL) {
  if (sending || !channelId)
    throw new Error("Join a channel before attaching a Canvas.");
  if (pending.length >= 4)
    throw new Error("Attach at most four canvases per message.");
  const [header, data] = dataURL.split(",");
  pending.push({
    data,
    kind: object.type === "drawing" ? "drawing" : "picture",
    content_type: header.slice(5, -7),
    canvas_id: object.id,
    canvas_revision: object.revision,
  });
  renderPending();
}
const canvases = setupCanvases({
  notify,
  onAttach: attachCanvas,
  canAttach: () => !!channelId && !sending,
  saveChannelBoard: async (object, resources) => {
    if (!token || object.channel.server !== server)
      throw new Error(
        "Connect to the owning backend before saving this channel board.",
      );
    const { channel, ...board } = object;
    const result = await api(`/channels/${channel.id}/board`, {
      method: "PUT",
      body: { board, canvases: resources, base_revision: object.revision - 1 },
    });
    return { ...result.board, channel };
  },
  onChange: () => {
    if (channelId) renderMessages();
    renderPending();
  },
});
$("picture").onclick = () => $("files").click();
$("files").onchange = async () => {
  const version = generation;
  try {
    for (const file of $("files").files) {
      if (sending || pending.length >= 4)
        throw new Error(
          "Wait for sending to finish and attach at most four canvases.",
        );
      const object = await canvases.importImage(file);
      if (version !== generation)
        throw new Error(
          "Channel changed; the image was kept in your Canvas library.",
        );
      await attachCanvas(object, canvases.preview(object));
    }
  } catch (error) {
    report(error);
  } finally {
    $("files").value = "";
  }
};
function exportPath(format) {
  let query = rangeQuery($("export-scope").value, selected);
  if ($("export-scope").value === "all" && exportSnapshot !== null)
    query = "to=" + exportSnapshot;
  return `/channels/${channelId}/export?format=${format}${query ? "&" + query : ""}`;
}
async function previewExport() {
  const version = ++exportVersion;
  preview = "";
  exportSnapshot = null;
  $("export-preview").textContent = "Preparing context…";
  for (const id of ["copy-context", "save-markdown", "save-bundle"])
    $(id).disabled = true;
  try {
    const result = await api(exportPath("markdown"));
    if (version !== exportVersion) return;
    exportSnapshot = result.through ?? null;
    preview = result.markdown;
    $("export-preview").textContent = preview;
    $("export-summary").textContent =
      `${result.count} messages · #${channelName}`;
    for (const id of ["copy-context", "save-markdown", "save-bundle"])
      $(id).disabled = false;
  } catch (error) {
    if (version === exportVersion) {
      $("export-preview").textContent = error.message;
      report(error);
    }
  }
}
$("export-open").onclick = () => {
  $("export-scope").value = selected.size ? "selection" : "all";
  $("export-dialog").showModal();
  previewExport();
};
$("export-scope").onchange = previewExport;
$("copy-context").onclick = async () => {
  try {
    await window.waystone.copyContext(preview);
    notify("Markdown copied. Use the ZIP to include the image files.");
  } catch (error) {
    report(error);
  }
};
$("save-markdown").onclick = async () => {
  try {
    const saved = await window.waystone.saveExport({
      name: `${channelName}.md`,
      bytes: new TextEncoder().encode(preview),
    });
    if (saved) notify("Markdown saved.");
  } catch (error) {
    report(error);
  }
};
$("save-bundle").onclick = async () => {
  if (exporting) return;
  exporting = true;
  $("save-bundle").disabled = true;
  try {
    const bytes = await api(exportPath("zip"), { binary: true });
    const saved = await window.waystone.saveExport({
      name: `${channelName}.zip`,
      bytes,
    });
    if (saved) notify("Context bundle saved.");
  } catch (error) {
    report(error);
  } finally {
    exporting = false;
    $("save-bundle").disabled = false;
  }
};
document
  .querySelectorAll("[data-close]")
  .forEach(
    (button) => (button.onclick = () => $(button.dataset.close).close()),
  );
$("leave").onclick = () => {
  call.leave();
  if (sending) return notify("Wait for your message to finish sending.");
  saveDraft();
  socket?.disconnect();
  token = null;
  subscription = null;
  generation++;
  channelId = null;
  messages = [];
  pending = [];
  imageUrls.forEach(URL.revokeObjectURL);
  imageUrls = [];
  imageCache.clear();
  $("workspace").hidden = true;
  $("join").hidden = false;
  notify("");
};
window.addEventListener("beforeunload", saveDraft);
window.addEventListener("beforeunload", () => call.leave());
