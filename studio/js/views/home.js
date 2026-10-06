// Workspace (admins) / My Workspace (staff): counts, quick create, the projects and team access
import { loadIndex, mediaURL } from '../store.js';
import { SITE_BASE } from '../config.js';
import { esc, statusBadge, timeAgo, TYPE_LABEL } from '../ui.js';

const SHOWN = 6; // projects listed here; the rest are on the Projects page

const icon = (paths) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  layers: icon('<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>'),
  check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  clock: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  file: icon('<path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  team: icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.9c1.8.7 3 2.4 3 5.1"/>'),
};
// the two turning arrows drawn over the product picture
const TURN = `<svg class="ws-turn" viewBox="0 0 300 200" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M62 86c-22 6-34 14-34 22 0 9 14 17 36 22"/><path d="m54 121 11 10-13 7"/>
  <path d="M238 86c22 6 34 14 34 22 0 9-14 17-36 22"/><path d="m246 121-11 10 13 7"/></svg>`;
// drawn stand-ins for when there is no project of that kind to borrow a picture from
const ART = {
  product: `<svg class="ws-art" viewBox="0 0 300 200" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M112 86h76l10 82H102l10-82Z"/><path d="M128 86c0-26 8-40 22-40s22 14 22 40"/></svg>`,
  showroom: `<svg class="ws-art" viewBox="0 0 300 200" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M30 150c40-18 80-27 120-27s80 9 120 27"/><path d="M30 56c40 14 80 21 120 21s80-7 120-21"/><path d="M30 56v94M270 56v94M110 73v53M190 73v53"/></svg>`,
};

const pageURL = (p) => `${SITE_BASE}/${p.type === 'showroom' ? 'showroom' : 'product'}.html?id=${encodeURIComponent(p.id)}`;

function createCard(type, cover) {
  const product = type === 'product';
  return `
    <article class="ws-card">
      <div class="ws-card-img${cover ? '' : ' is-art'}">
        ${cover ? `<img src="${esc(mediaURL(cover))}" alt="" loading="lazy">` : ART[type]}
        ${product && cover ? TURN : ''}
      </div>
      <div class="ws-card-body">
        <h3>${product ? 'Product 360°' : 'Showroom'}</h3>
        <p>${product ? 'Turn photos or a turntable video into a 360° product view.' : 'Build a walk-through from 360° panoramas with hotspots.'}</p>
        <a class="btn" href="#/new/${type}">Create ${product ? 'Product 360°' : 'Showroom'} <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
}

function projectCard(p) {
  const open = `#/project/${encodeURIComponent(p.id)}`;
  return `
    <li class="ws-card ws-card--project" data-type="${esc(p.type)}" data-status="${esc(p.status)}">
      <a class="ws-card-img" href="${open}" tabindex="-1" aria-hidden="true">
        ${p.cover ? `<img src="${esc(mediaURL(p.cover))}" alt="" loading="lazy">` : '<span class="ws-noimg">No media yet</span>'}
      </a>
      <div class="ws-card-body">
        <h3>${esc(p.title)}</h3>
        <div class="ws-meta"><span>${TYPE_LABEL[p.type]}</span>${statusBadge(p.status)}</div>
        <div class="ws-meta"><span>${esc(p.updatedBy || '')} · ${timeAgo(p.updatedAt)}</span></div>
        <a class="btn" href="${open}">Open project <span aria-hidden="true">→</span></a>
      </div>
      <details class="ws-menu">
        <summary aria-label="More actions for ${esc(p.title)}"><span aria-hidden="true">···</span></summary>
        <div class="ws-menu-list">
          <a href="${esc(pageURL(p))}&preview=1" target="_blank" rel="noopener">Preview ↗</a>
          ${p.published ? `<a href="#/publish/${encodeURIComponent(p.id)}">Share link &amp; QR code</a>` : '<a href="#/publish">Publish</a>'}
          <a href="${open}">Edit</a>
        </div>
      </details>
    </li>`;
}

export async function render(el, { user }) {
  const index = await loadIndex();
  const all = index.projects;
  const isAdmin = user.role === 'admin';
  // admins look after everything; staff see the projects they created or edited
  const list = isAdmin ? all : all.filter((p) => p.createdBy === user.login || p.updatedBy === user.login);
  const count = (s) => all.filter((p) => p.status === s).length;
  const coverOf = (type) => all.find((p) => p.type === type && p.cover)?.cover || '';
  const FILTERS = [['all', 'All'], ['product', 'Product 360°'], ['showroom', 'Showroom'], ['draft', 'Drafts']];

  el.innerHTML = `
    <div class="page-head ws-head">
      <div>
        <p class="eyebrow-sm">${isAdmin ? 'Workspace' : 'My Workspace'}</p>
        <h1>Hello, ${esc(user.name)}</h1>
        <p class="ws-sub">Manage your 360° product views and showroom experiences.</p>
      </div>
      <div class="actions"><a class="btn ws-new" href="#/new">+ New Project</a></div>
    </div>

    <div class="ws-stats">
      <div class="ws-stat"><div><b>${all.length}</b><span>Projects</span></div><i class="ws-ico">${ICONS.layers}</i></div>
      <div class="ws-stat"><div><b>${count('published')}</b><span>Published</span></div><i class="ws-ico ws-ico--ok">${ICONS.check}</i></div>
      <div class="ws-stat"><div><b>${count('changed')}</b><span>Unpublished</span></div><i class="ws-ico">${ICONS.clock}</i></div>
      <div class="ws-stat"><div><b>${count('draft')}</b><span>Drafts</span></div><i class="ws-ico">${ICONS.file}</i></div>
    </div>

    <section class="ws-block" aria-labelledby="ws-create-h">
      <h2 class="ws-h" id="ws-create-h">Quick create</h2>
      <div class="ws-grid">${createCard('product', coverOf('product'))}${createCard('showroom', coverOf('showroom'))}</div>
      <p class="ws-phone">Shooting with a phone?
        <a href="../capture/product.html" target="_blank" rel="noopener">Product photos ↗</a>
        <a href="../capture/" target="_blank" rel="noopener">Showroom panorama ↗</a></p>
    </section>

    <section class="ws-block" aria-labelledby="ws-projects-h">
      <div class="ws-block-head">
        <h2 class="ws-h" id="ws-projects-h">Your projects</h2>
        <div class="ws-filters" role="group" aria-label="Show">
          ${FILTERS.map(([v, l], i) => `<button type="button" data-filter="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}
        </div>
      </div>
      <ul class="ws-grid" id="ws-list">${list.map(projectCard).join('')}</ul>
      <div class="empty" id="ws-empty" hidden></div>
      <p class="ws-more" id="ws-more" hidden><a href="#/projects">All projects →</a></p>
    </section>

    ${isAdmin ? `
    <section class="ws-team">
      <i class="ws-ico">${ICONS.team}</i>
      <h2>Team access</h2>
      <p>Invite staff, set who is an admin, and remove access.</p>
      <a href="#/team">Manage accounts →</a>
    </section>` : ''}`;

  const $ = (s) => el.querySelector(s);
  const cards = [...el.querySelectorAll('.ws-card--project')];
  function applyFilter(filter) {
    el.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    const match = cards.filter((c) => filter === 'all' || (filter === 'draft' ? c.dataset.status === 'draft' : c.dataset.type === filter));
    cards.forEach((c) => { c.hidden = !match.slice(0, SHOWN).includes(c); });
    $('#ws-more').hidden = match.length <= SHOWN;
    const empty = $('#ws-empty');
    empty.hidden = match.length > 0;
    if (!match.length) {
      empty.innerHTML = !list.length
        ? (isAdmin ? 'No projects yet. Start with <a href="#/new">New Project</a>.' : 'Projects you create or edit appear here.')
        : filter === 'draft' ? 'No drafts — every project has been published.' : `No ${filter === 'product' ? 'Product 360°' : 'Showroom'} projects yet.`;
    }
  }
  $('.ws-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) applyFilter(b.dataset.filter); });
  applyFilter('all');

  // the ··· menus: one open at a time, closed by a click elsewhere or Escape
  const menus = [...el.querySelectorAll('.ws-menu')];
  const closeMenus = (except) => menus.forEach((m) => { if (m !== except) m.open = false; });
  menus.forEach((m) => m.addEventListener('toggle', () => { if (m.open) closeMenus(m); }));
  const onClick = (e) => { if (!e.target.closest('.ws-menu')) closeMenus(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenus(); };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  return {
    destroy() {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    },
  };
}
