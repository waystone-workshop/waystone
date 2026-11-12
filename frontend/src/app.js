import policy from "../policy.cjs";
import { setupCanvases } from "./canvases.js";
import { Socket, Presence } from "phoenix";
import { icon, mountIcons } from "./icons.mjs";
import { Room, RoomEvent, Track } from "livekit-client";
import { AudioCall } from "./audio.mjs";
import { voiceCaptureFor, voicePublish, readAudioPreferences } from "./audio-quality.mjs";
import { readVideoPreferences, videoCaptureFor } from "./video-quality.mjs";
import { createNoiseProcessor } from "./noise-processor.mjs";
import { setupUpdates } from "./updates.mjs";
import { setupProfiles } from "./profiles.mjs";
import { setupSettings } from "./settings.mjs";
import { createSounds, joinedIds, notifyForMessage } from "./sounds.mjs";
import { mergeMessages, rangeQuery } from "./context.mjs";
const $ = (id) => document.getElementById(id);
mountIcons(document);
let directory, activeVoiceRoom = null, voiceRooms = [], voiceState = { state: "idle", participants: [], camera: false, sharing: false }, lastVoiceState = null, lastCaptureId = null;
let spaces = [];
let server,
  currentUser,
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
  imageUrls = [],
  replying = null,
  editing = null;
let library = { emoji: [], stickers: [] };
let serverPolicy = {
  expression_uploads: "member",
  emoji_max_bytes: 262144,
  sticker_max_bytes: 524288,
  expression_limit: 200,
};
const expressionUrls = new Map();
const stored = JSON.parse(localStorage.getItem("waystone-preferences") || "{}");
$("server").value = stored.server || process.env.WAYSTONE_SERVER_URL;
$("name").value = stored.name || "";
function notify(text) {
  $("notice").textContent = text;
}
function report(error) {
  if (error.message.includes("Please sign in again.")) signOut(false);
  notify(
    error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
  );
}
setupUpdates(window.waystone, document, report);
const api = (path, options = {}) =>
  window.waystone.request({ server, token, path: "/api" + path, ...options });
function applyUser(user) {
  currentUser = user;
  name = user.display_name;
  $("identity").textContent = `${name} · ${user.role}`;
  $("self-avatar").replaceChildren(profiles.avatar(user));
  const manages = ["admin", "moderator"].includes(user.role);
  $("add-channel").hidden = !manages;
  $("delete-channel").hidden = !manages;
  $("add-voice-room").hidden = !manages;
  settings.refresh();
}
const profiles = setupProfiles({ document, api, changed: applyUser, signedOut: () => signOut(false), report });
const peoplePreference = localStorage.getItem("waystone-people-open") !== "false";
function setPeopleOpen(open) {
  $("people-panel").hidden = !open;
  $("workspace").classList.toggle("people-collapsed", !open);
  $("members-toggle").setAttribute("aria-expanded", String(open));
  localStorage.setItem("waystone-people-open", String(open));
}
setPeopleOpen(peoplePreference);
$("members-toggle").onclick = () => setPeopleOpen($("people-panel").hidden);
$("members-collapse").onclick = () => setPeopleOpen(false);
const sounds = createSounds();
let onlineIds = null;
const settings = setupSettings({
  document, bridge: window.waystone, report, openProfile: () => $("profile-open").click(),
  user: () => currentUser, avatar: (person) => profiles.avatar(person),
  onVideoChange: () => call.applyVideo().catch(report),
  permit: () => currentUser?.role === "admin" || canManage() || canAddExpressions(),
  onExpressions: () => renderExpressionShelf(),
});
$("settings-open").onclick = () => { settings.open(); $("settings-dialog").showModal(); };
$("space-open").onclick = () => { $("space-search").value = ""; renderSpaces(); $("space-dialog").showModal(); $("space-search").focus(); };
$("space-search").oninput = renderSpaces;
function spaceLabel(space) { return space.name === "general" ? "The Common Room" : space.name.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function renderSpaces() {
  const query = $("space-search").value.trim().toLowerCase();
  const filtered = spaces.filter((space) => `${space.name} ${spaceLabel(space)}`.toLowerCase().includes(query));
  $("space-no-results").hidden = filtered.length > 0;
  $("channels").replaceChildren(...filtered.map((space) => {
    const button = el("button", spaceLabel(space));
    button.dataset.id = space.id; button.classList.toggle("active", space.id === channelId);
    button.onclick = async () => { try { await switchChannel(space); $("space-dialog").close(); } catch (error) { report(error); } };
    return button;
  }));
}
$("auth-mode").onchange = () => {
  const register = $("auth-mode").value === "register";
  $("display-name-field").hidden = !register;
  $("invite-field").hidden = !register;
  $("invite").required = register;
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("auth-submit").textContent = register ? "Create account →" : "Sign in →";
  $("auth-hint").textContent = register ? "Use your invitation code once to join. Passwords need at least 12 characters." : "Sign in with your username and password.";
};
const call = new AudioCall({
  createRoom: () => {
    const video = videoCaptureFor(readVideoPreferences());
    return new Room({
      audioCaptureDefaults: voiceCaptureFor(readAudioPreferences()),
      videoCaptureDefaults: { resolution: video.resolution },
      publishDefaults: { ...voicePublish, videoEncoding: video.encoding, screenShareEncoding: video.encoding },
    });
  },
  createProcessor: createNoiseProcessor,
  microphoneSource: Track.Source.Microphone,
  cameraSource: Track.Source.Camera,
  screenSource: Track.Source.ScreenShare,
  mediaRoot: $("call-media"),
  videoStage: $("call-stage"),
  videoCameras: $("call-cameras"),
  prepareShare: () => lastCaptureId && window.waystone.chooseCapture?.(lastCaptureId),
  events: RoomEvent,
  credentials: (id) => api(`/voice-rooms/${id}/call`, { method: "POST" }),
  audioHost: $("call-audio"),
  failed: report,
  changed: ({ state, muted, deafened, participants, playbackBlocked, camera, sharing }) => {
    voiceState = { state, muted, deafened, participants, playbackBlocked, camera, sharing };
    const idle = state === "idle";
    if (idle) $("call-media").hidden = true;
    $("join-audio").hidden = !idle;
    $("join-audio").disabled = false;
    $("call-panel").hidden = idle;
    $("call-state").textContent = state === "joining" ? "Connecting audio…"
      : state === "reconnecting" ? "Reconnecting audio…" : "Audio connected";
    $("call-channel").textContent = activeVoiceRoom?.name.replaceAll("-", " ") || "Voice";
    $("call-count").textContent = participants.length ? `· ${participants.length}` : "";
    $("call-mute").innerHTML = icon(muted ? "muted" : "mic");
    $("call-mute").setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
    $("call-mute").title = muted ? "Unmute microphone" : "Mute microphone";
    $("call-mute").setAttribute("aria-pressed", String(muted));
    $("call-mute").disabled = state !== "connected";
    $("call-camera").disabled = state !== "connected";
    $("call-camera").setAttribute("aria-pressed", String(Boolean(camera)));
    $("call-camera").title = camera ? "Turn camera off" : "Turn camera on";
    $("call-camera").setAttribute("aria-label", camera ? "Turn camera off" : "Turn camera on");
    $("call-share").disabled = state !== "connected";
    $("call-share").setAttribute("aria-pressed", String(Boolean(sharing)));
    $("call-share").title = sharing ? "Stop sharing" : "Share a window or the desk";
    $("call-share").setAttribute("aria-label", sharing ? "Stop sharing" : "Share a window or the desk");
    $("call-deafen").textContent = deafened ? "Enable sound" : "Deafen";
    $("call-deafen").setAttribute("aria-pressed", String(deafened));
    $("call-resume").hidden = !playbackBlocked;
    $("call-participants").replaceChildren(...participants.map((person) => {
      const item = el("li");
      const label = el("button", `${person.name}${person.self ? " (you)" : ""}${person.muted ? " · muted" : ""}`);
      label.onclick = () => { if (person.user_id) profiles.show(person.user_id, label); };
      label.disabled = !person.user_id; item.append(label);
      item.classList.toggle("speaking", Boolean(person.speaking));
      return item;
    }));
    pushVoicePresence();
  },
});
async function loadVoiceRooms() {
  const session = token;
  const result = await api("/voice-rooms");
  if (session !== token || !token) return;
  voiceRooms = result.rooms; profiles.setRooms(voiceRooms);
  if (activeVoiceRoom && !voiceRooms.some((room) => room.id === activeVoiceRoom.id)) { call.leave(); activeVoiceRoom = null; }
  $("voice-rooms").replaceChildren(...voiceRooms.map((room) => {
    const row = el("div", undefined, "voice-room-row");
    const join = el("button", undefined, "voice-room-choice");
    const mark = el("span"); mark.innerHTML = icon("headphones");
    join.append(mark, el("strong", room.name.replaceAll("-", " ")), el("small", activeVoiceRoom?.id === room.id && voiceState.state !== "idle" ? "Connected" : "Join voice"));
    join.onclick = async () => {
      if (activeVoiceRoom?.id === room.id && voiceState.state !== "idle") { $("voice-dialog").close(); return; }
      if (voiceState.state !== "idle" && !confirm(`Leave ${activeVoiceRoom?.name} and join ${room.name}?`)) return;
      call.leave(); activeVoiceRoom = room; $("voice-dialog").close(); await call.join(room.id);
    }; row.append(join);
    if (["admin", "moderator"].includes(currentUser?.role)) {
      const remove = el("button", "Delete", "voice-room-delete");
      remove.setAttribute("aria-label", `Delete voice room ${room.name}`);
      remove.onclick = async () => { if (!confirm(`Delete voice room ${room.name}? Connected users will leave the room.`)) return; try { await api(`/voice-rooms/${room.id}`, { method: "DELETE" }); await loadVoiceRooms(); } catch (error) { report(error); } };
      row.append(remove);
    }
    return row;
  }));
  if (!voiceRooms.length) $("voice-rooms").append(el("p", "No voice rooms yet. A moderator can create one.", "subtle"));
}
async function showVoiceRooms() { try { await loadVoiceRooms(); $("voice-dialog").showModal(); } catch (error) { report(error); } }
$("join-audio").onclick = showVoiceRooms;
$("voice-switch").onclick = () => { $("call-details").open = false; showVoiceRooms(); };
$("add-voice-room").onclick = () => { $("voice-dialog").close(); $("voice-create-dialog").showModal(); };
$("voice-create-form").onsubmit = async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector(".primary"); button.disabled = true;
  try { await api("/voice-rooms", { method: "POST", body: { name: $("voice-room-name").value } }); $("voice-create-dialog").close(); $("voice-room-name").value = ""; await showVoiceRooms(); } catch (error) { report(error); } finally { button.disabled = false; }
};
function pushVoicePresence() {
  if (!directory || directory.state !== "joined") return;
  const meta = { voice_room_id: ["connected", "reconnecting"].includes(voiceState.state) ? activeVoiceRoom?.id || null : null, muted: Boolean(voiceState.muted), speaking: Boolean(voiceState.participants.find((person) => person.self)?.speaking) };
  const key = JSON.stringify(meta); if (key === lastVoiceState) return;
  lastVoiceState = key; directory.push("voice_state", meta);
}
$("call-leave").onclick = () => { lastCaptureId = null; call.leave(); };
$("call-mute").onclick = () => call.mute();
$("call-camera").onclick = () => call.camera(!voiceState.camera);
$("call-share").onclick = () => { if (voiceState.sharing) call.share(false); else openShare().catch(report); };
async function openShare() {
  if (voiceState.state !== "connected") return;
  if (!window.waystone.captureSources) { await call.share(true); return; }
  const sources = await window.waystone.captureSources();
  const list = $("share-sources");
  list.replaceChildren(...sources.map((source) => {
    const button = el("button", undefined, "share-source");
    button.type = "button";
    if (source.thumbnail) {
      const img = el("img");
      img.alt = "";
      img.src = source.thumbnail;
      button.append(img);
    }
    button.append(el("strong", source.kind === "screen" ? "Whole desk" : "Window"), el("span", source.name));
    // getDisplayMedia only succeeds during this click. An await before it
    // drops the gesture and Chromium answers "Permission denied".
    button.onclick = () => {
      try {
        lastCaptureId = source.id;
        $("share-dialog").close();
        window.waystone.chooseCapture({ id: source.id, name: source.name });
        call.share(true).catch(report);
      } catch (error) { report(error); }
    };
    return button;
  }));
  if (!sources.length) list.append(el("p", "No windows are available to share.", "subtle"));
  $("share-dialog").showModal();
}
$("call-deafen").onclick = () => call.deafen();
$("call-resume").onclick = () => call.resume();
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function draftKey() {
  return `draft:${server}:${currentUser?.id || name}:${channelId}`;
}
function saveDraft() {
  if (channelId) localStorage.setItem(draftKey(), $("body").value);
}
$("body").addEventListener("input", () => {
  if (editing) return;
  saveDraft();
  $("draft-status").textContent = "Draft saved locally";
});
document.addEventListener("waystone-board-view", ({ detail }) => {
  $("conversation-view").classList.toggle("active", !detail.embedded);
  $("conversation-view").setAttribute("aria-pressed", String(!detail.embedded));
  $("open-channel-board").classList.toggle("active", detail.embedded);
  $("open-channel-board").setAttribute("aria-pressed", String(detail.embedded));
});
$("board-dialog").addEventListener("close", () => {
  $("conversation-view").classList.add("active"); $("conversation-view").setAttribute("aria-pressed", "true");
  $("open-channel-board").classList.remove("active"); $("open-channel-board").setAttribute("aria-pressed", "false");
});
$("conversation-view").onclick = () => { if ($("board-dialog").open) $("board-close").click(); };
function authRejected(error) {
  return /sign in again|Unauthorized|401/.test(error.message);
}
async function rememberSession(user) {
  localStorage.setItem("waystone-preferences", JSON.stringify({ server, name: user.username }));
  await window.waystone.saveSession?.({ server, token, username: user.username });
}
async function beginSession(user) {
  applyUser(user);
  $("invite").value = "";
  $("password").value = "";
  await rememberSession(user);
  socket = new Socket(server.replace(/^http/, "ws") + "/socket", { params: { token } });
  socket.onOpen(() => { $("connection").textContent = "Connected"; });
  socket.onClose(() => { $("connection").textContent = "Reconnecting…"; profiles.setPresence({}, false); });
  socket.onError(() => { $("connection").textContent = "Connection interrupted"; });
  socket.connect();
  await loadChannels();
  directory = socket.channel("directory", {});
  const presence = new Presence(directory);
  presence.onSync(() => {
    const ids = Object.entries(presence.state || {})
      .filter(([, value]) => (value?.metas || []).length)
      .map(([id]) => String(id));
    if (onlineIds && joinedIds(onlineIds, ids).some((id) => id !== String(currentUser?.id))) sounds.login();
    onlineIds = ids;
    profiles.setPresence(presence.state);
    pushVoicePresence();
  });
  directory.on("profile_updated", () => profiles.refresh().catch(report));
  directory.on("voice_rooms_updated", () => loadVoiceRooms().catch(report));
  directory.on("channel_created", () => loadChannels().catch(report));
  directory.on("channel_deleted", () => loadChannels().catch(report));
  directory.on("board_updated", (event) => {
    if (event.channel_id === channelId)
      notify("The channel board was updated. Open it again to load the latest saved version.");
  });
  directory.on("server_updated", (policy) => applyServerPolicy(policy));
  directory.join().receive("ok", () => { lastVoiceState = null; loadChannels().catch(report); profiles.refresh().catch(report); });
  await profiles.refresh();
  await loadVoiceRooms();
  await loadServerSettings().catch((error) => {
    if (!authRejected(error)) report(error);
  });
  $("gate-status").hidden = true;
  $("join").hidden = true;
  $("workspace").hidden = false;
  sounds.login();
  notify("");
  loadExpressions().catch((error) => {
    if (!authRejected(error)) report(error);
  });
}
$("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter || $("join-form").querySelector("button");
  button.disabled = true;
  try {
    server = policy.validateServer($("server").value.trim());
    const register = $("auth-mode").value === "register";
    const result = await api(register ? "/register" : "/session", {
      body: { username: $("name").value, password: $("password").value, display_name: $("display-name").value.trim() || $("name").value, invite_code: register ? $("invite").value : undefined },
    });
    token = result.token;
    await beginSession(result.user);
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
});
async function restoreSession() {
  if (!window.waystone?.loadSession) return;
  $("join-form").hidden = true;
  $("gate-status").hidden = false;
  $("gate-status").textContent = "Checking your sign-in…";
  let saved = null;
  try { saved = await window.waystone.loadSession(); } catch { saved = null; }
  if (!saved?.token) {
    $("join-form").hidden = false;
    $("gate-status").hidden = true;
    return;
  }
  try {
    server = policy.validateServer(saved.server);
    token = saved.token;
    $("server").value = server;
    if (saved.username) $("name").value = saved.username;
    await beginSession(await api("/me"));
  } catch (error) {
    if (authRejected(error)) {
      token = null;
      await window.waystone.clearSession?.().catch(() => {});
    }
    if ($("workspace").hidden) {
      $("join-form").hidden = false;
      $("gate-status").hidden = true;
    }
    if (!authRejected(error)) report(error);
  }
}
restoreSession();
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
  spaces = result.channels; renderSpaces();
  if (!channelId && result.channels.length)
    await switchChannel(result.channels[0]);
}
function forgetPending(channel = channelId) {
  const files = pending.filter((item) => item.kind === "file" && item.file_id);
  pending = [];
  renderPending();
  if (!channel || !token) return;
  for (const file of files) {
    api(`/channels/${channel}/files/${file.file_id}`, { method: "DELETE" }).catch(() => {});
  }
}
function resetChannel() {
  forgetPending();
  subscription?.leave();
  subscription = null;
  generation++;
  channelId = null;
  channelName = null;
  channelBoardId = null;
  messages = [];
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
  if (channelId === channel.id) return;
  if ($("board-dialog").open) { $("board-close").click(); if ($("board-dialog").open) return; }
  if (sending) return notify("Wait for your message to finish sending.");
  if (
    pending.length &&
    !confirm(
      "Discard the unsent attachments and switch channels? Your text draft will be kept.",
    )
  )
    return;
  const leaving = channelId;
  if (editing || replying) {
    editing = null;
    replying = null;
    $("body").value = localStorage.getItem(draftKey()) || "";
    renderContext();
  }
  saveDraft();
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
  forgetPending(leaving);
  $("body").value = localStorage.getItem(draftKey()) || "";
  renderPending();
  $("channel-title").textContent = spaceLabel(channel);
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
    const known = messages.some((item) => item.id === message.id);
    messages = mergeMessages(messages, [message]);
    renderMessages();
    if (!known && notifyForMessage(message, currentUser?.id)) sounds.message();
  });
  subscription.on("message_updated", (message) => {
    if (version !== generation) return;
    messages = mergeMessages(messages, [message]);
    renderMessages();
  });
  subscription.on("message_deleted", (event) => {
    if (version !== generation) return;
    dropMessage(event.id);
  });
  subscription.on("reaction", (event) => {
    if (version !== generation) return;
    applyReaction(event);
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
function renderMessages(pin) {
  const list = $("messages");
  const top = list.scrollTop;
  const height = list.scrollHeight;
  const nearBottom = height - top - list.clientHeight < 80;
  const stick = pin === "bottom" || (pin !== "prepend" && pin !== "keep" && nearBottom);
  list.dataset.stick = stick ? "1" : "0";
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
        message.user_id === currentUser?.id ? "message mine" : "message",
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
      const author = el(message.user_id ? "button" : "strong", message.author);
      if (message.user_id) { author.className = "author-profile"; author.onclick = () => profiles.show(message.user_id, author); }
      const date = new Date(message.inserted_at);
      const today = date.toDateString() === new Date().toDateString();
      const time = el("time", today ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
      time.dateTime = message.inserted_at; time.title = date.toLocaleString();
      meta.append(author, time, el("span", "#" + message.id));
      if (message.edited_at) meta.append(el("span", "edited", "edited"));
      content.append(meta);
      if (message.reply) content.append(replyQuote(message.reply));
      if (message.body) content.append(renderBody(message.body));
      const reactions = reactionRow(message);
      if (reactions) content.append(reactions);
      for (const attachment of message.attachments || []) {
        if (attachment.kind === "sticker") {
          content.append(stickerTile(attachment));
          continue;
        }
        if (attachment.kind === "file") {
          content.append(fileCard(message, attachment));
          continue;
        }
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
              if (list.dataset.stick === "1") list.scrollTop = list.scrollHeight;
              return;
            }
            if (imageCache.has(attachment.id)) {
              image.src = imageCache.get(attachment.id);
              if (list.dataset.stick === "1") list.scrollTop = list.scrollHeight;
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
            if (list.dataset.stick === "1") list.scrollTop = list.scrollHeight;
          } catch {
            image.alt = "Image unavailable — reconnect and reload the channel.";
          }
        };
        content.append(image);
        queueMicrotask(load);
      }
      const portrait = el(message.user_id ? "button" : "span", undefined, "message-avatar");
      portrait.append(profiles.avatar(profiles.get(message.user_id) || { display_name: message.author, avatar_color: "slate" }));
      if (message.user_id) { portrait.setAttribute("aria-label", `View ${message.author}'s profile`); portrait.onclick = () => profiles.show(message.user_id, portrait); }
      row.append(check, portrait, content, messageActions(message));
      return row;
    }),
  );
  if (pin === "prepend") list.scrollTop = top + list.scrollHeight - height;
  else if (stick) {
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(() => {
      if (list.dataset.stick === "1") list.scrollTop = list.scrollHeight;
    });
  } else list.scrollTop = top;
}
$("older").onclick = async () => {
  const version = generation;
  try {
    const result = await api(
      `/channels/${channelId}/messages?before=${messages[0].id}`,
    );
    if (version !== generation) return;
    messages = mergeMessages(messages, result.messages);
    renderMessages("prepend");
    $("older").hidden = result.messages.length < 100;
  } catch (error) {
    report(error);
  }
};
$("add-channel").onclick = () => { $("space-dialog").close(); $("channel-dialog").showModal(); };
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
  const text = $("body").value;
  const empty = !text.trim() && !pending.length;
  if (!channelId || sending) return;
  if (editing) {
    if (!text.trim() && !(editing.attachments || []).length) return;
  } else if (empty) return;
  sending = true;
  $("send").disabled = true;
  $("body").disabled = true;
  const sendVersion = generation;
  const editingId = editing?.id;
  try {
    if (editingId) {
      const message = await api(`/messages/${editingId}`, { method: "PUT", body: { body: text } });
      if (sendVersion !== generation) return;
      messages = mergeMessages(messages, [message]);
      editing = null;
      $("body").value = localStorage.getItem(draftKey()) || "";
      renderContext();
      renderMessages("keep");
      notify("");
      return;
    }
    const replyTo = replying?.id || null;
    const message = await api(`/channels/${channelId}/messages`, {
      body: {
        body: text,
        reply_to: replyTo,
        attachments: pending.map((attachment) => {
          if (attachment.kind === "file")
            return { kind: "file", file_id: attachment.file_id };
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
    replying = null;
    renderContext();
    renderPending();
    $("body").value = "";
    saveDraft();
    $("draft-status").textContent = "";
    renderMessages("bottom");
    notify("");
  } catch (error) {
    report(error);
  } finally {
    sending = false;
    $("send").disabled = !channelId;
    $("body").disabled = false;
    $("body").focus();
    if ($("messages").dataset.stick === "1") $("messages").scrollTop = $("messages").scrollHeight;
  }
};
$("body").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
};
function canManage() {
  return ["admin", "moderator"].includes(currentUser?.role);
}
function actionButton(name, label, onClick) {
  const button = el("button", undefined, `icon-button ${name}`);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon(name);
  button.onclick = (event) => {
    event.stopPropagation();
    onClick();
  };
  return button;
}
function messageActions(message) {
  const actions = el("div", undefined, "message-actions");
  actions.append(actionButton("smile", "Add reaction", () => openExpressions("react", message)));
  actions.append(actionButton("reply", "Reply", () => startReply(message)));
  if (message.user_id && message.user_id === currentUser?.id)
    actions.append(actionButton("pen", "Edit", () => startEdit(message)));
  if ((message.user_id && message.user_id === currentUser?.id) || canManage())
    actions.append(actionButton("trash", "Delete", () => removeMessage(message).catch(report)));
  return actions;
}
function startReply(message) {
  if (editing) cancelEdit();
  replying = message;
  renderContext();
  $("body").focus();
}
function startEdit(message) {
  replying = null;
  editing = message;
  $("body").value = message.body || "";
  renderContext();
  $("body").focus();
}
function cancelEdit() {
  editing = null;
  $("body").value = channelId ? localStorage.getItem(draftKey()) || "" : "";
  renderContext();
}
function renderContext() {
  const bar = $("composer-context");
  bar.replaceChildren();
  if (editing) {
    bar.hidden = false;
    bar.append(el("span", "Editing your message"));
    const cancel = el("button", "Cancel");
    cancel.type = "button";
    cancel.id = "cancel-context";
    cancel.onclick = () => cancelEdit();
    bar.append(cancel);
    $("send").setAttribute("aria-label", "Save edit");
    $("send").title = "Save edit";
  } else if (replying) {
    bar.hidden = false;
    const text = el("span");
    const preview = (replying.body || replying.attachments?.[0]?.name || "Attachment").slice(0, 140);
    text.append(el("strong", `Replying to ${replying.author}`), document.createTextNode(` ${preview}`));
    const cancel = el("button", "Cancel");
    cancel.type = "button";
    cancel.id = "cancel-context";
    cancel.onclick = () => {
      replying = null;
      renderContext();
    };
    bar.append(text, cancel);
    $("send").setAttribute("aria-label", "Send message");
    $("send").title = "Send message";
  } else {
    bar.hidden = true;
    $("send").setAttribute("aria-label", "Send message");
    $("send").title = "Send message";
  }
  for (const id of ["picture", "share-file", "draw", "expressions"]) $(id).disabled = Boolean(editing);
}
function replyQuote(reply) {
  const quote = el("button", undefined, "reply-quote");
  quote.type = "button";
  const label = reply.body || reply.attachment?.name || "Attachment";
  quote.append(el("strong", reply.author || "Message"), el("span", label));
  quote.onclick = () => {
    document.querySelector(`#messages article[data-id="${reply.id}"]`)?.scrollIntoView({ block: "center" });
  };
  return quote;
}
function renderBody(text) {
  const paragraph = el("p");
  const pattern = /:([a-z0-9_]{2,32}):/g;
  const source = String(text);
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) paragraph.append(source.slice(last, match.index));
    const emoji = library.emoji.find((item) => item.name === match[1]);
    if (emoji) {
      const image = el("img");
      image.className = "emoji";
      image.alt = `:${emoji.name}:`;
      image.title = `:${emoji.name}:`;
      loadExpression(emoji, image);
      paragraph.append(image);
    } else paragraph.append(match[0]);
    last = match.index + match[0].length;
  }
  if (last < source.length) paragraph.append(source.slice(last));
  return paragraph;
}
function stickerTile(attachment) {
  const tile = el("div", undefined, "sticker");
  const image = el("img");
  const known = library.stickers.find((item) => item.id === attachment.id);
  image.alt = known ? attachment.name || "Sticker" : "Sticker no longer available";
  if (known) loadExpression(known, image);
  tile.append(image);
  return tile;
}
function loadExpression(item, image) {
  if (expressionUrls.has(item.id)) {
    image.src = expressionUrls.get(item.id);
    return;
  }
  api(`/expressions/${item.id}`, { binary: true })
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: item.content_type || "image/png" }));
      expressionUrls.set(item.id, url);
      if (image.isConnected) image.src = url;
    })
    .catch(() => {
      image.alt = "Image unavailable";
    });
}
function dropMessage(id) {
  messages = messages
    .filter((message) => message.id !== id)
    .map((message) => (message.reply?.id === id ? { ...message, reply: null } : message));
  selected.delete(id);
  if (replying?.id === id) {
    replying = null;
    renderContext();
  }
  if (editing?.id === id) cancelEdit();
  renderMessages();
}
async function removeMessage(message) {
  if (!confirm("Delete this message?")) return;
  await api(`/messages/${message.id}`, { method: "DELETE" });
  dropMessage(message.id);
}
function canAddExpressions() {
  const who = serverPolicy.expression_uploads;
  const role = currentUser?.role;
  if (who === "off") return false;
  if (who === "admin") return role === "admin";
  if (who === "moderator") return role === "admin" || role === "moderator";
  return Boolean(currentUser);
}
function kilobytes(bytes) {
  const n = Math.round(Number(bytes) / 1024);
  return n >= 1024 ? `${Math.round(n / 1024)} MB` : `${n} KB`;
}
function applyServerPolicy(policy) {
  if (!policy || typeof policy.expression_uploads !== "string") return;
  serverPolicy = policy;
  renderServerPolicy();
  settings.refresh();
  if ($("expression-dialog").open) renderExpressionGrid();
}
function renderServerPolicy() {
  if (!$("expression-uploads")) return;
  $("expression-uploads").value = serverPolicy.expression_uploads || "member";
  $("emoji-max-kb").value = String(Math.round((serverPolicy.emoji_max_bytes || 262144) / 1024));
  $("sticker-max-kb").value = String(Math.round((serverPolicy.sticker_max_bytes || 524288) / 1024));
  $("expression-limit").value = String(serverPolicy.expression_limit || 200);
  if ($("expression-policy")) $("expression-policy").hidden = currentUser?.role !== "admin";
  renderExpressionShelf();
}
async function loadServerSettings() {
  applyServerPolicy(await api("/server"));
}
async function loadExpressions() {
  const result = await api("/expressions");
  library = {
    emoji: Array.isArray(result.emoji) ? result.emoji : [],
    stickers: Array.isArray(result.stickers) ? result.stickers : [],
  };
  if (!$("workspace").hidden) renderMessages();
  renderExpressionShelf();
}
let expressionKind = "emoji";
let expressionPurpose = "insert";
let reactingTo = null;
function reactionRow(message) {
  const reactions = message.reactions || [];
  if (!reactions.length) return null;
  const row = el("div", undefined, "reactions");
  for (const reaction of reactions) {
    const mine = (reaction.user_ids || []).includes(currentUser?.id);
    const button = el("button", undefined, mine ? "reaction mine" : "reaction");
    button.type = "button";
    button.title = reaction.name;
    const emoji = library.emoji.find((item) => item.name === reaction.name);
    if (emoji) {
      const image = el("img");
      image.alt = reaction.name;
      loadExpression(emoji, image);
      button.append(image);
    } else button.append(el("span", `:${reaction.name}:`));
    button.append(el("span", String((reaction.user_ids || []).length)));
    button.onclick = () => toggleReaction(message, reaction.name).catch(report);
    row.append(button);
  }
  return row;
}
function applyReaction(event) {
  if (!event?.id) return;
  messages = messages.map((message) =>
    message.id === event.id ? { ...message, reactions: event.reactions || [] } : message,
  );
  renderMessages();
}
async function toggleReaction(message, name) {
  applyReaction(await api(`/messages/${message.id}/reactions`, { method: "POST", body: { name } }));
}
function openExpressions(purpose, message) {
  expressionPurpose = purpose;
  reactingTo = message || null;
  expressionKind = "emoji";
  renderExpressionGrid();
  $("expression-dialog").showModal();
}
function renderExpressionGrid() {
  if (expressionPurpose === "react") expressionKind = "emoji";
  $("expression-title").textContent = expressionPurpose === "react" ? "Add a reaction" : "Emoji and stickers";
  $("sticker-tab").hidden = expressionPurpose === "react";
  $("emoji-tab").setAttribute("aria-pressed", String(expressionKind === "emoji"));
  $("sticker-tab").setAttribute("aria-pressed", String(expressionKind === "sticker"));
  const items = expressionKind === "emoji" ? library.emoji : library.stickers;
  const grid = $("expression-grid");
  grid.replaceChildren();
  if (!items.length) {
    grid.append(el("p", expressionKind === "emoji" ? "No custom emoji yet." : "No stickers yet.", "subtle"));
    return;
  }
  for (const item of items) {
    const card = el("div", undefined, "expression-item");
    const button = el("button");
    button.type = "button";
    const image = el("img");
    image.alt = item.name;
    loadExpression(item, image);
    button.append(image, el("span", item.name));
    button.onclick = () => useExpression(item).catch(report);
    card.append(button);
    grid.append(card);
  }
}
function renderExpressionShelf() {
  const form = $("expression-form");
  if (!form) return;
  const allowed = canAddExpressions();
  const kind = $("expression-kind")?.value || "emoji";
  form.hidden = !allowed;
  if ($("expression-hint")) {
    $("expression-hint").textContent = allowed
      ? kind === "sticker"
        ? `Stickers send on their own. PNG, JPEG, GIF, or WebP, up to ${kilobytes(serverPolicy.sticker_max_bytes)}.`
        : `Emoji drop into a message as :name:. PNG, JPEG, GIF, or WebP, up to ${kilobytes(serverPolicy.emoji_max_bytes)}.`
      : "This room is not accepting new emoji or stickers.";
  }
  const shelf = $("expression-shelf");
  if (!shelf) return;
  const items = [...library.emoji, ...library.stickers];
  shelf.replaceChildren();
  if (!items.length) {
    shelf.append(el("p", "No custom emoji or stickers yet.", "subtle"));
    return;
  }
  for (const item of items) {
    const card = el("div", undefined, "expression-item");
    const image = el("img");
    image.alt = item.name;
    loadExpression(item, image);
    card.append(image, el("span", `${item.kind === "sticker" ? "Sticker" : "Emoji"} · ${item.name}`));
    if (item.user_id === currentUser?.id || canManage()) {
      const remove = el("button", "Remove", "expression-remove");
      remove.type = "button";
      remove.onclick = async () => {
        if (!confirm(`Remove :${item.name}:?`)) return;
        try {
          await api(`/expressions/${item.id}`, { method: "DELETE" });
          const key = item.kind === "sticker" ? "stickers" : "emoji";
          library[key] = library[key].filter((entry) => entry.id !== item.id);
          const url = expressionUrls.get(item.id);
          if (url) URL.revokeObjectURL(url);
          expressionUrls.delete(item.id);
          renderExpressionShelf();
          if ($("expression-dialog").open) renderExpressionGrid();
          renderMessages();
        } catch (error) {
          report(error);
        }
      };
      card.append(remove);
    }
    shelf.append(card);
  }
}
async function useExpression(item) {
  if (expressionPurpose === "react" && reactingTo) {
    await toggleReaction(reactingTo, item.name);
    $("expression-dialog").close();
    return;
  }
  if (item.kind !== "sticker") {
    const area = $("body");
    const token = `:${item.name}:`;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    area.value = area.value.slice(0, start) + token + area.value.slice(end);
    if (!editing) saveDraft();
    area.focus();
    $("expression-dialog").close();
    return;
  }
  if (!channelId || sending || editing) return;
  sending = true;
  try {
    const message = await api(`/channels/${channelId}/messages`, {
      body: {
        body: "",
        reply_to: replying?.id || null,
        attachments: [{ kind: "sticker", expression_id: item.id }],
      },
    });
    messages = mergeMessages(messages, [message]);
    replying = null;
    renderContext();
    renderMessages("bottom");
    $("expression-dialog").close();
  } finally {
    sending = false;
  }
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
$("expressions").onclick = () => openExpressions("insert");
$("expression-kind")?.addEventListener("change", () => renderExpressionShelf());
$("emoji-tab").onclick = () => {
  expressionKind = "emoji";
  renderExpressionGrid();
};
$("sticker-tab").onclick = () => {
  expressionKind = "sticker";
  renderExpressionGrid();
};
$("server-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter || $("server-form").querySelector("button");
  button.disabled = true;
  try {
    applyServerPolicy(await api("/server", {
      method: "PUT",
      body: {
        expression_uploads: $("expression-uploads").value,
        emoji_max_bytes: Number($("emoji-max-kb").value) * 1024,
        sticker_max_bytes: Number($("sticker-max-kb").value) * 1024,
        expression_limit: Number($("expression-limit").value),
      },
    }));
    notify("Server settings saved.");
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
};
$("expression-form").onsubmit = async (event) => {
  event.preventDefault();
  const file = $("expression-file").files[0];
  if (!file) return;
  $("expression-upload").disabled = true;
  try {
    const created = await api("/expressions", {
      method: "POST",
      body: {
        kind: $("expression-kind").value,
        name: $("expression-name").value,
        data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      },
    });
    const key = created.kind === "sticker" ? "stickers" : "emoji";
    library[key] = [...library[key].filter((item) => item.id !== created.id), created].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    $("expression-form").reset();
    renderExpressionShelf();
    if ($("expression-dialog").open) renderExpressionGrid();
  } catch (error) {
    report(error);
  } finally {
    $("expression-upload").disabled = false;
  }
};
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes) || 0, unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  const rounded = unit === 0 ? String(Math.round(size)) : size.toFixed(size >= 10 ? 0 : 1);
  return `${rounded} ${units[unit]}`;
}
function fileCard(message, attachment) {
  const button = el("button", undefined, "shared-file");
  button.type = "button";
  button.title = `Save ${attachment.name}`;
  button.append(el("span", attachment.name), el("span", formatSize(attachment.byte_size), "file-size"));
  button.onclick = () => saveSharedFile(message, attachment).catch(report);
  return button;
}
async function saveSharedFile(message, attachment) {
  const path = `/api/messages/${message.id}/attachments/${attachment.id}`;
  if (window.waystone.saveSharedFile) {
    const saved = await window.waystone.saveSharedFile({ server, token, path, name: attachment.name });
    if (saved) notify(`Saved ${attachment.name}`);
    return;
  }
  const bytes = await api(path.slice(4), { binary: true });
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = el("a");
  link.href = url;
  link.download = attachment.name || "file";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderPending() {
  $("pending").replaceChildren(
    ...pending.map((attachment, index) => {
      if (attachment.kind === "file") return pendingFile(attachment, index);
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
function pendingFile(attachment, index) {
  const wrapper = el("div", undefined, "pending-file");
  wrapper.append(el("span", attachment.name), el("span", formatSize(attachment.byte_size), "file-size"));
  const remove = el("button", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${attachment.name}`);
  remove.onclick = () => {
    if (sending) return;
    pending.splice(index, 1);
    renderPending();
    api(`/channels/${channelId}/files/${attachment.file_id}`, { method: "DELETE" }).catch(() => {});
  };
  wrapper.append(remove);
  return wrapper;
}
async function shareFromDesktop() {
  if (sending || !channelId) return report(new Error("Join a channel before sharing a file."));
  if (pending.length >= 4) return report(new Error("Attach at most four files or images per message."));
  const version = generation;
  const channel = channelId;
  const status = $("draft-status");
  status.textContent = "Sharing a file…";
  try {
    const file = await window.waystone.shareFile({ server, token, channelId: channel });
    if (!file) return;
    if (version !== generation || channelId !== channel || pending.length >= 4) {
      api(`/channels/${channel}/files/${file.id}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    pending.push({ kind: "file", file_id: file.id, name: file.name, byte_size: file.byte_size });
    renderPending();
  } catch (error) {
    report(error);
  } finally {
    if (status.textContent === "Sharing a file…") status.textContent = "";
  }
}
async function shareFromBrowser(file) {
  if (sending || !channelId) throw new Error("Join a channel before sharing a file.");
  if (!file.size) throw new Error("Choose a file that isn't empty.");
  if (file.size > 256 * 1024 * 1024) throw new Error("Files can be up to 256 MB.");
  const response = await fetch(`${server}/api/channels/${channelId}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
    signal: AbortSignal.timeout(1_800_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Could not share that file (${response.status})`);
  }
  return response.json();
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
$("share-file").onclick = () => {
  if (window.waystone.shareFile) shareFromDesktop();
  else $("share-file-input").click();
};
$("share-file-input").onchange = async () => {
  const [file] = $("share-file-input").files || [];
  $("share-file-input").value = "";
  if (!file) return;
  const version = generation;
  const channel = channelId;
  const status = $("draft-status");
  status.textContent = "Sharing a file…";
  try {
    if (pending.length >= 4) throw new Error("Attach at most four files or images per message.");
    const uploaded = await shareFromBrowser(file);
    if (version !== generation || channelId !== channel || pending.length >= 4) {
      api(`/channels/${channel}/files/${uploaded.id}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    pending.push({ kind: "file", file_id: uploaded.id, name: uploaded.name, byte_size: uploaded.byte_size });
    renderPending();
  } catch (error) {
    report(error);
  } finally {
    if (status.textContent === "Sharing a file…") status.textContent = "";
  }
};
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
async function signOut(revoke = true) {
  if (revoke && sending) return notify("Wait for your message to finish sending.");
  if ($("board-dialog").open) {
    if (revoke) { $("board-close").click(); if ($("board-dialog").open) return; }
    else $("board-dialog").close();
  }
  if (revoke && token) {
    try { await api("/session", { method: "DELETE" }); }
    catch (error) { report(error); return; }
  }
  call.leave();
  if (editing) $("body").value = localStorage.getItem(draftKey()) || "";
  editing = null;
  replying = null;
  renderContext();
  saveDraft();
  forgetPending();
  socket?.disconnect();
  token = null;
  await window.waystone.clearSession?.().catch(() => {});
  currentUser = null;
  onlineIds = null;
  library = { emoji: [], stickers: [] };
  serverPolicy = {
    expression_uploads: "member",
    emoji_max_bytes: 262144,
    sticker_max_bytes: 524288,
    expression_limit: 200,
  };
  expressionUrls.forEach((url) => URL.revokeObjectURL(url));
  expressionUrls.clear();
  $("composer-context").hidden = true;
  $("expression-dialog").close();
  profiles.clear(); directory = null; activeVoiceRoom = null; lastVoiceState = null; voiceRooms = []; spaces = [];
  for (const id of ["profile-dialog", "members-dialog", "public-profile-dialog", "settings-dialog", "space-dialog", "voice-dialog", "voice-create-dialog"]) $(id).close();
  $("password-form").reset();
  subscription = null;
  generation++;
  channelId = null;
  messages = [];
  pending = [];
  imageUrls.forEach(URL.revokeObjectURL);
  imageUrls = [];
  imageCache.clear();
  $("workspace").hidden = true;
  $("join-form").hidden = false;
  $("gate-status").hidden = true;
  $("join").hidden = false;
  notify("");
}
$("leave").onclick = () => signOut();
window.addEventListener("beforeunload", saveDraft);
window.addEventListener("beforeunload", () => call.leave());
