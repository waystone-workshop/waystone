// Line icons share one stroke weight across the desktop shell.
const paths = {
  chevron: '<path d="m6 9 6 6 6-6"/>', collapse: '<path d="m14 6-6 6 6 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  muted: '<path d="m2 2 20 20M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v5M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8"/>',
  headphones: '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  hangup: '<path d="M3 14c5-6 13-6 18 0v4h-5v-4a16 16 0 0 0-8 0v4H3z"/>',
  attach: '<path d="m21 11-9 9a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6L9 19a2 2 0 0 1-3-3L16 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  pen: '<path d="m16 3 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 6 6v5"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  send: '<path d="m22 2-7 20-4-9L2 9zM22 2 11 13"/>', signal: '<path d="M4 20v-4M9 20v-8M14 20V8M19 20V4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', settings: '<path d="m12 3 2 3 4-.5.5 4 3 2-3 2-.5 4-4-.5-2 3-2-3-4 .5-.5-4-3-2 3-2 .5-4 4 .5z"/><circle cx="12" cy="12" r="3"/>',
};
export function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.people}</svg>`; }
export function mountIcons(document) { document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); }); }
