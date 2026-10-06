// Shared bits for the Workspace and Projects pages: icons, the ··· menu on a project,
// and the New Project button with its type menu
import { esc, statusBadge, timeAgo, TYPE_LABEL, toast } from '../ui.js';
import { mediaURL, loadProject, deleteProject } from '../store.js';
import { SITE_BASE } from '../config.js';

export const icon = (paths) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  layers: icon('<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>'),
  check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  clock: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  file: icon('<path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  team: icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.9c1.8.7 3 2.4 3 5.1"/>'),
  folder: icon('<path d="M3.5 6.5h6l2 2.5h9v10h-17v-12.5Z"/>'),
  box: icon('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  image: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5.5-5 3.5 3 2.5-2 4.5 4"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  grid: icon('<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>'),
  list: icon('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.4"/>'),
};

export const pageURL = (p) => `${SITE_BASE}/${p.type === 'showroom' ? 'showroom' : 'product'}.html?id=${encodeURIComponent(p.id)}`;
export const openURL = (p) => `#/project/${encodeURIComponent(p.id)}`;

/** Who may delete a project: admins, and the person who created it while it has never been published. */
export const canDelete = (p, user) => user.role === 'admin' || (p.createdBy === user.login && !p.published);

/** The ··· menu on a project: preview, share or publish, edit, and delete for those allowed to. */
export function projectMenu(p, user) {
  return `
    <details class="ws-menu">
      <summary aria-label="More actions for ${esc(p.title)}"><span aria-hidden="true">···</span></summary>
      <div class="ws-menu-list">
        <a href="${esc(pageURL(p))}&preview=1" target="_blank" rel="noopener">Preview ↗</a>
        ${p.published ? `<a href="#/publish/${encodeURIComponent(p.id)}">Share link &amp; QR code</a>` : '<a href="#/publish">Publish</a>'}
        <a href="${openURL(p)}">Edit</a>
        ${user && canDelete(p, user) ? `<button type="button" class="ws-menu-danger" data-delete="${esc(p.id)}">Delete</button>` : ''}
      </div>
    </details>`;
}

/** Makes the Delete item in the ··· menus work. Asks first, deletes the project with its media, then calls onDeleted. */
export function bindDelete(el, { saved, onDeleted }) {
  let busy = false;
  const onClick = async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn || busy) return;
    busy = true;
    const label = btn.textContent;
    try {
      const { project: p, sha } = await loadProject(btn.dataset.delete);
      if (!confirm(`Delete "${p.title}"? Its photos and panoramas are deleted too${p.published ? ', and the public page stops working' : ''}. This cannot be undone.`)) return;
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      await deleteProject(p, sha);
      saved?.();
      toast('Project deleted');
      onDeleted?.(p);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      toast(err.message, true);
    } finally {
      busy = false;
    }
  };
  el.addEventListener('click', onClick);
  return () => el.removeEventListener('click', onClick);
}

/** "+ New Project": opens a small menu to choose the project type (this replaces the old type page). */
export function newProjectButton(cls = '') {
  return `
    <details class="np ${cls}">
      <summary class="btn">+ New Project</summary>
      <div class="np-list">
        <a href="#/new/product">${ICONS.box}<b>Product 360°</b></a>
        <a href="#/new/showroom">${ICONS.image}<b>Showroom / Scene</b></a>
      </div>
    </details>`;
}

/** Keeps one menu open at a time and closes them on a click elsewhere or Escape. Returns the clean-up. */
export function bindMenus(el) {
  const menus = () => [...el.querySelectorAll('details.ws-menu, details.np')];
  const closeAll = (except) => menus().forEach((m) => { if (m !== except) m.open = false; });
  const onToggle = (e) => { if (e.target.matches?.('details.ws-menu, details.np') && e.target.open) closeAll(e.target); };
  const onClick = (e) => { if (!e.target.closest('details.ws-menu, details.np')) closeAll(); };
  const onKey = (e) => { if (e.key === 'Escape') closeAll(); };
  el.addEventListener('toggle', onToggle, true); // toggle does not bubble, so listen on the way down
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  return () => {
    el.removeEventListener('toggle', onToggle, true);
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };
}

/** A project as a tall card: picture on top, then name, type, status and who edited it. */
export function projectCard(p, user) {
  const open = openURL(p);
  return `
    <li class="pj-card">
      <a class="pj-card-img" href="${open}" tabindex="-1" aria-hidden="true">
        ${p.cover ? `<img src="${esc(mediaURL(p.cover))}" alt="" loading="lazy">` : '<span class="ws-noimg">No media yet</span>'}
      </a>
      ${projectMenu(p, user)}
      <div class="pj-card-body">
        <h3><a href="${open}">${esc(p.title)}</a></h3>
        <div class="ws-meta"><span>${TYPE_LABEL[p.type]}</span>${statusBadge(p.status)}</div>
        <div class="ws-meta"><span>${esc(p.updatedBy || '')} · ${timeAgo(p.updatedAt)}</span></div>
        <a class="pj-open" href="${open}">Open project <span aria-hidden="true">→</span></a>
      </div>
    </li>`;
}
