// Projects — every project, with filters down the side, search, sorting, and New Project
import { loadIndex } from '../store.js';
import { esc } from '../ui.js';
import { ICONS, projectCard, newProjectButton, bindMenus } from './common.js';

const SORTS = {
  updated: ['Recently updated', (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')],
  oldest: ['Oldest first', (a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || '')],
  name: ['Name A–Z', (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })],
};

export async function render(el, { user, param }) {
  const index = await loadIndex();
  const all = index.projects;
  const n = (test) => all.filter(test).length;
  const state = { type: '', status: '' };

  el.innerHTML = `
    <div class="pj">
      <aside class="pj-side" aria-label="Filter projects">
        <h2>Library</h2>
        <ul class="pj-nav">
          <li><button type="button" data-type="">${ICONS.folder}<span>All projects</span><i>${all.length}</i></button></li>
          <li><button type="button" data-type="product">${ICONS.box}<span>Product 360°</span><i>${n((p) => p.type === 'product')}</i></button></li>
          <li><button type="button" data-type="showroom">${ICONS.image}<span>Showroom / Scene</span><i>${n((p) => p.type === 'showroom')}</i></button></li>
        </ul>
        <h2>Status</h2>
        <ul class="pj-nav">
          <li><button type="button" data-status="published"><span class="pj-dot pj-dot--ok"></span><span>Published</span><i>${n((p) => p.status === 'published')}</i></button></li>
          <li><button type="button" data-status="changed"><span class="pj-dot pj-dot--warn"></span><span>Unpublished changes</span><i>${n((p) => p.status === 'changed')}</i></button></li>
          <li><button type="button" data-status="draft"><span class="pj-dot"></span><span>Draft</span><i>${n((p) => p.status === 'draft')}</i></button></li>
        </ul>
        <label class="check pj-mine"><input type="checkbox" id="mine"> Only mine</label>
      </aside>

      <div class="pj-main">
        <div class="page-head pj-head">
          <div>
            <h1>Projects</h1>
            <p class="ws-sub">Browse and manage your 360° experiences.</p>
          </div>
          <div class="actions">${newProjectButton('np--tan')}</div>
        </div>
        <div class="pj-tools">
          <label class="pj-search">${ICONS.search}<input class="input" id="q" type="search" placeholder="Search projects" aria-label="Search projects"></label>
          <label class="pj-sort"><span>Sort by</span>
            <select class="select" id="sort">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</select></label>
        </div>
        <p class="status" id="count" aria-live="polite"></p>
        <ul class="pj-grid" id="list"></ul>
        <div class="empty" id="empty" hidden></div>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = all.filter((p) =>
      (!q || p.title.toLowerCase().includes(q) || p.id.includes(q))
      && (!state.type || p.type === state.type)
      && (!state.status || p.status === state.status)
      && (!$('#mine').checked || p.createdBy === user.login || p.updatedBy === user.login))
      .sort(SORTS[$('#sort').value][1]);
    el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
    el.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === state.status)));
    $('#count').textContent = `${list.length} of ${all.length} project${all.length === 1 ? '' : 's'}`;
    $('#list').innerHTML = list.map(projectCard).join('');
    $('#empty').hidden = list.length > 0;
    if (!list.length) $('#empty').innerHTML = all.length ? 'No projects match these filters.' : 'No projects yet. Press <b>+ New Project</b> to start.';
  };
  $('.pj-side').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('type' in b.dataset) state.type = b.dataset.type;
    else state.status = state.status === b.dataset.status ? '' : b.dataset.status; // press again to clear
    draw();
  });
  ['#q', '#sort', '#mine'].forEach((s) => $(s).addEventListener('input', draw));
  draw();

  const unbind = bindMenus(el);
  if (param === 'new') { // arriving from a "New Project" link elsewhere: show the type menu straight away
    $('.np').open = true;
    $('.np summary').focus();
  }
  return { destroy: unbind };
}

export { esc };
