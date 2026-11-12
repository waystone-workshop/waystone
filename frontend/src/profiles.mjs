import { icon } from "./icons.mjs";

export function setupProfiles({ document, api, changed, signedOut, report }) {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  let people = [], presence = {}, rooms = [], onlineKnown = false, epoch = 0, shown = null, profileRequest = 0;
  const media = new Map();
  async function mediaUrl(person, kind) {
    const version = person[`${kind}_version`];
    if (!version) return null;
    const key = `${person.id}:${kind}:${version}`;
    if (!media.has(key)) {
      const stamp = epoch;
      const pending = api(`/users/${person.id}/media/${kind}?v=${version}`, { binary: true }).then((bytes) => {
        if (stamp !== epoch) return null;
        return URL.createObjectURL(new Blob([bytes], { type: person[`${kind}_content_type`] || "image/png" }));
      }).catch(() => { media.delete(key); return null; });
      media.set(key, pending);
    }
    return media.get(key);
  }
  function avatar(person) {
    const color = ["pine", "amber", "slate", "berry"].includes(person.avatar_color) ? person.avatar_color : "slate";
    const element = node("span", (person.display_name || "?").slice(0, 2).toUpperCase(), `avatar avatar-${color}`);
    if (person.avatar_version) mediaUrl(person, "avatar").then((url) => {
      if (!url) return;
      const image = node("img"); image.alt = ""; image.onerror = () => { element.textContent = (person.display_name || "?").slice(0, 2).toUpperCase(); }; image.src = url; element.replaceChildren(image);
    });
    return element;
  }
  function banner(person) {
    const element = node("div", undefined, "profile-banner");
    if (person.banner_version) mediaUrl(person, "banner").then((url) => {
      if (!url) return;
      const image = node("img"); image.alt = `${person.display_name}'s banner`; image.onerror = () => image.remove(); image.src = url; element.replaceChildren(image);
    });
    return element;
  }
  const metas = (id) => presence[String(id)]?.metas || [];
  const voiceMeta = (id) => metas(id).find((meta) => meta.voice_room_id != null);
  const roomName = (id) => rooms.find((room) => room.id === id)?.name || "voice";
  function card(person) {
    const wrapper = node("div", undefined, "profile-card-content");
    const content = node("div", undefined, "profile-card-body");
    content.append(avatar(person), node("h2", person.display_name), node("p", `@${person.username}`, "profile-username"));
    const active = voiceMeta(person.id);
    content.append(node("p", !onlineKnown ? "Presence unavailable" : active ? `In ${roomName(active.voice_room_id)}` : metas(person.id).length ? "Around" : "Offline", "profile-presence"));
    if (person.bio) content.append(node("p", person.bio, "profile-bio"));
    content.append(node("small", `Joined ${new Date(person.inserted_at).toLocaleDateString()}`));
    wrapper.append(banner(person), content); return wrapper;
  }
  function closePopover() {
    const popover = $("profile-popover");
    if (typeof popover.hidePopover === "function") popover.hidePopover();
    popover.classList.remove("is-open");
  }
  async function show(id, anchor) {
    const request = ++profileRequest;
    try {
      const person = await api(`/users/${id}`);
      if (request !== profileRequest) return;
      shown = person;
      $("profile-card").replaceChildren(card(person));
      const popover = $("profile-popover");
      const rect = anchor?.getBoundingClientRect();
      const view = document.defaultView;
      const left = rect ? (rect.left >= 356 ? rect.left - 352 : rect.right + 12) : view.innerWidth - 356;
      popover.style.left = `${Math.max(12, Math.min(left, view.innerWidth - 356))}px`;
      popover.style.top = `${Math.max(12, Math.min(rect?.top || 140, view.innerHeight - 500))}px`;
      (anchor?.closest("dialog[open]") || document.body).append(popover);
      if (typeof popover.showPopover === "function") popover.showPopover(); else popover.classList.add("is-open");
    } catch (error) { report(error); }
  }
  $("profile-popover-close").onclick = closePopover;
  document.defaultView.addEventListener("resize", closePopover);
  $("view-full-profile").onclick = () => {
    if (!shown) return;
    closePopover(); $("public-profile").replaceChildren(card(shown)); $("public-profile-dialog").showModal();
  };
  function renderPeople() {
    const online = people.filter((person) => onlineKnown && metas(person.id).length);
    const offline = people.filter((person) => !onlineKnown || !metas(person.id).length);
    $("presence-status").textContent = onlineKnown ? `${online.length} around · ${people.length} members` : "Presence unavailable — reconnecting";
    const row = (person) => {
      const button = node("button", undefined, "person-row");
      button.dataset.userId = person.id;
      const active = voiceMeta(person.id);
      button.classList.toggle("is-speaking", Boolean(active && metas(person.id).some((meta) => meta.speaking)));
      const portrait = avatar(person); portrait.classList.toggle("is-online", onlineKnown && metas(person.id).length > 0);
      const text = node("span", undefined, "person-copy"); text.append(node("strong", person.display_name));
      if (active) text.append(node("small", `In ${roomName(active.voice_room_id)}`));
      button.append(portrait, text);
      if (active) { const status = node("span", undefined, "person-voice"); status.innerHTML = icon(active.muted ? "muted" : "signal"); status.setAttribute("aria-label", active.muted ? "Microphone muted" : "In voice"); button.append(status); }
      button.onclick = () => show(person.id, button); return button;
    };
    const group = (title, members) => {
      const section = node("section", undefined, "people-group"); section.append(node("h3", title), ...members.map(row)); return section;
    };
    const inVoice = online.filter((person) => voiceMeta(person.id));
    const around = online.filter((person) => !voiceMeta(person.id));
    $("people-online").replaceChildren(...[inVoice.length && group("Hanging out", inVoice), around.length && group("Around", around)].filter(Boolean));
    $("offline-title").textContent = onlineKnown ? `Offline · ${offline.length}` : `Members · ${offline.length}`;
    $("people-offline").replaceChildren(...offline.map(row));
  }
  async function refresh() {
    const stamp = epoch;
    const result = await api("/users");
    if (stamp !== epoch) return;
    people = result.users; renderPeople();
  }
  function setPresence(state, known = true) { presence = state; onlineKnown = known; renderPeople(); }
  function gathering() {
    if (!onlineKnown) return [];
    return people.flatMap((person) => {
      const meta = voiceMeta(person.id);
      if (!meta) return [];
      return [{ id: person.id, name: person.display_name, roomId: Number(meta.voice_room_id), muted: Boolean(meta.muted), speaking: Boolean(meta.speaking) }];
    });
  }
  function setRooms(value) { rooms = value; renderPeople(); }
  function clear() {
    epoch++; profileRequest++; people = []; presence = {}; onlineKnown = false; shown = null; closePopover();
    for (const promise of media.values()) promise.then((url) => { if (url) URL.revokeObjectURL(url); });
    media.clear(); renderPeople();
  }
  async function members() {
    const current = await api("/me"); changed(current);
    await refresh();
    $("members-list").replaceChildren(...people.map((person) => {
      const row = node("div", undefined, "member-row");
      const open = node("button", undefined, "member-profile");
      open.append(avatar(person), node("span", `${person.display_name} (@${person.username})`));
      open.onclick = () => show(person.id, open); row.append(open, node("span", person.role, "role-label"));
      if (current.role === "admin") {
        const select = node("select"); select.setAttribute("aria-label", `Role for ${person.username}`);
        for (const role of ["member", "moderator", "admin"]) { const option = node("option", role); option.value = role; select.append(option); }
        select.value = person.role;
        const save = node("button", "Save role"); save.onclick = async () => {
          save.disabled = true;
          try { await api(`/users/${person.id}/role`, { method: "PUT", body: { role: select.value } }); await members(); }
          catch (error) { report(error); } finally { save.disabled = false; }
        }; row.append(select, save);
      }
      return row;
    }));
  }
  $("members-open").onclick = async () => { try { await members(); $("members-dialog").showModal(); } catch (error) { report(error); } };
  function editMedia(person) {
    const image = banner(person);
    $("profile-edit-banner").replaceChildren(image);
    $("profile-edit-avatar").replaceChildren(avatar(person));
    for (const kind of ["avatar", "banner"]) $(`${kind}-remove`).disabled = !person[`${kind}_version`];
  }
  $("profile-open").onclick = async () => {
    try {
      $("settings-dialog").close();
      const person = await api("/me"); changed(person);
      $("profile-account").textContent = `@${person.username} · ${person.role}`;
      $("profile-name").value = person.display_name; $("profile-bio").value = person.bio; $("profile-color").value = person.avatar_color;
      $("profile-upload-status").textContent = ""; editMedia(person); $("profile-dialog").showModal();
    } catch (error) { report(error); }
  };
  for (const kind of ["avatar", "banner"]) {
    $(`${kind}-upload`).onchange = async (event) => {
      const file = event.target.files[0]; if (!file) return;
      event.target.disabled = true;
      $("profile-upload-status").classList.remove("upload-error");
      $("profile-upload-status").textContent = `Uploading ${kind}…`;
      try {
        const maxMB = kind === "avatar" ? 10 : 20;
        if (file.size > maxMB * 1024 * 1024) throw Error(`${kind === "avatar" ? "Avatar" : "Banner"} must be ${maxMB} MB or smaller.`);
        const data = await new Promise((resolve, reject) => {
          const reader = new document.defaultView.FileReader(); reader.onerror = () => reject(Error("Could not read image")); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(file);
        });
        const person = await api(`/me/media/${kind}`, { method: "PUT", body: { data } });
        changed(person); editMedia(person); await refresh(); $("profile-upload-status").textContent = `${kind === "avatar" ? "Avatar" : "Banner"} saved.`;
      } catch (error) { $("profile-upload-status").textContent = error.message; $("profile-upload-status").classList.add("upload-error"); report(error); } finally { event.target.disabled = false; event.target.value = ""; }
    };
    $(`${kind}-remove`).onclick = async () => {
      try { const person = await api(`/me/media/${kind}`, { method: "DELETE" }); changed(person); editMedia(person); await refresh(); $("profile-upload-status").textContent = `${kind} removed.`; } catch (error) { report(error); }
    };
  }
  $("profile-form").onsubmit = async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try {
      changed(await api("/me", { method: "PUT", body: { display_name: $("profile-name").value, bio: $("profile-bio").value, avatar_color: $("profile-color").value } }));
      await refresh(); $("profile-dialog").close();
    } catch (error) { report(error); } finally { button.disabled = false; }
  };
  $("password-form").onsubmit = async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try { await api("/me/password", { method: "PUT", body: { current_password: $("current-password").value, password: $("new-password").value } }); $("password-form").reset(); $("profile-dialog").close(); signedOut(); }
    catch (error) { report(error); } finally { button.disabled = false; }
  };
  return { show, avatar, refresh, setPresence, setRooms, clear, gathering, get: (id) => people.find((person) => person.id === id) };
}
