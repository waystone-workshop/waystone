export function setupProfiles({ document, api, changed, signedOut, report }) {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const avatar = (person) => node("span", person.display_name.slice(0, 2).toUpperCase(), `avatar avatar-${person.avatar_color}`);
  async function show(id) {
    try {
      const person = await api(`/users/${id}`);
      $("public-profile").replaceChildren(avatar(person), node("h2", person.display_name), node("p", `@${person.username} · ${person.role}`, "role-label"), node("p", person.bio || "Still writing their story."), node("small", `Joined ${new Date(person.inserted_at).toLocaleDateString()}`));
      $("public-profile-dialog").showModal();
    } catch (error) { report(error); }
  }
  async function members() {
    const current = await api("/me");
    changed(current);
    const { users } = await api("/users");
    $("members-list").replaceChildren(...users.map((person) => {
      const row = node("div", undefined, "member-row");
      const open = node("button", undefined, "member-profile");
      open.append(avatar(person), node("span", `${person.display_name} (@${person.username})`));
      open.onclick = () => show(person.id);
      row.append(open, node("span", person.role, "role-label"));
      if (current.role === "admin") {
        const select = node("select");
        select.setAttribute("aria-label", `Role for ${person.username}`);
        for (const role of ["member", "moderator", "admin"]) {
          const option = node("option", role); option.value = role; select.append(option);
        }
        select.value = person.role;
        const save = node("button", "Save role");
        save.onclick = async () => {
          save.disabled = true;
          try { await api(`/users/${person.id}/role`, { method: "PUT", body: { role: select.value } }); await members(); }
          catch (error) { report(error); }
          finally { save.disabled = false; }
        };
        row.append(select, save);
      }
      return row;
    }));
  }
  $("members-open").onclick = async () => {
    try { await members(); $("members-dialog").showModal(); } catch (error) { report(error); }
  };
  $("profile-open").onclick = async () => {
    try {
      const person = await api("/me"); changed(person);
      $("profile-account").textContent = `@${person.username} · ${person.role}`;
      $("profile-name").value = person.display_name;
      $("profile-bio").value = person.bio;
      $("profile-color").value = person.avatar_color;
      $("profile-dialog").showModal();
    } catch (error) { report(error); }
  };
  $("profile-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try {
      changed(await api("/me", { method: "PUT", body: { display_name: $("profile-name").value, bio: $("profile-bio").value, avatar_color: $("profile-color").value } }));
      $("profile-dialog").close();
    } catch (error) { report(error); } finally { button.disabled = false; }
  };
  $("password-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try {
      await api("/me/password", { method: "PUT", body: { current_password: $("current-password").value, password: $("new-password").value } });
      $("password-form").reset(); $("profile-dialog").close(); signedOut();
    } catch (error) { report(error); } finally { button.disabled = false; }
  };
  return { show };
}
