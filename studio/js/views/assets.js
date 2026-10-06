// Asset Library — every photo, panorama and 3D model in the repository
import { listAssets, loadAllProjects, loadLibrary, uploadAssets, deleteAssets, mediaURL, referenced, isReferenced } from '../store.js';
import { preparePanorama } from '../media-tools.js';
import { esc, toast, slugify } from '../ui.js';
import { icon, ICONS, bindMenus } from './common.js';

const LIMIT = 1024 ** 3; // GitHub Pages site limit (1 GB)
const mb = (n) => (n < 100 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`);

function group(files) {
  const groups = [];
  const spins = new Map();
  const paths = new Set(files.map((f) => f.path));
  const thumbFor = (path) => [path.replace(/\.(jpe?g|png|webp)$/i, '.thumb.jpg'), path.replace(/\.(jpe?g|png|webp)$/i, '-thumb.jpg')].find((t) => paths.has(t));
  for (const f of files) {
    if (/\.thumb\.jpg$/.test(f.path)) continue;
    if (/-thumb\.jpg$/.test(f.path) && paths.has(f.path.replace(/-thumb\.jpg$/, '.jpg'))) continue;
    const m = f.path.match(/^(.*)\/frame-\d+\.(jpe?g|png|webp)$/i);
    if (m) {
      const g = spins.get(m[1]) || { kind: 'spin', type: 'spin', key: m[1], path: `${m[1]}/`, files: [], size: 0, cover: f.path };
      g.files.push(f.path); g.size += f.size;
      if (f.path < g.cover) g.cover = f.path;
      spins.set(m[1], g);
      continue;
    }
    const kind = /\.(glb|usdz)$/i.test(f.path) ? 'model'
      : f.path.startsWith('media/library/') ? 'image'
      : 'panorama';
    // a panorama that belongs to one showroom is a "showroom photo"; the rest are the shared pool
    const type = kind !== 'panorama' ? kind
      : /^media\/(scenes|showroom)\//.test(f.path) ? 'showroom'
      : f.path.startsWith('media/products/') ? 'image'
      : 'panorama';
    const thumb = thumbFor(f.path);
    groups.push({ kind, type, key: f.path, path: f.path, files: [f.path, ...(thumb ? [thumb] : [])], size: f.size, cover: kind === 'model' ? '' : thumb || f.path });
  }
  return [...groups, ...spins.values()];
}

/**
 * When a file was added. GitHub's file list has no dates, but the Studio and the phone capture
 * put the time in the name (…-<time in base 36> or pano-YYYYMMDDHHMM). 0 when the name has none.
 */
function addedAt(it) {
  const name = it.kind === 'spin' ? it.key.split('/').pop() : it.path.split('/').pop().replace(/\.[^.]+$/, '');
  const d = name.match(/(?:^|-)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (d) return new Date(+d[1], d[2] - 1, +d[3], +d[4], +d[5]).getTime() || 0;
  const b = name.match(/-([0-9a-z]{8})$/);
  const t = b ? parseInt(b[1], 36) : 0;
  return t > Date.UTC(2024, 0, 1) && t < Date.now() + 864e5 ? t : 0;
}

const PANO_ICON = icon('<path d="M3 7c3 1.3 6 2 9 2s6-.7 9-2v10c-3-1.3-6-2-9-2s-6 .7-9 2V7Z"/><path d="m7 14 3-2.5 2.5 2 2-1.5 2.5 2"/>');
const SPIN_ICON = icon('<path d="M12 5.5c4.7 0 8.5 1.5 8.5 3.4S16.7 12.3 12 12.3 3.5 10.8 3.5 8.9"/><path d="M3.5 8.9v5.2c0 1.9 3.8 3.4 8.5 3.4"/><path d="m9.5 15 2.5 2.5L9.5 20"/><path d="M20.5 8.9v5.2c0 .9-.9 1.7-2.3 2.3"/>');
// the chip on each card; `tab` is the tab the type is counted under
const TYPES = {
  panorama: { label: 'Panorama', tab: 'panorama', icon: PANO_ICON },
  showroom: { label: 'Showroom photo', tab: 'panorama', icon: ICONS.image },
  spin: { label: 'Product photo set', tab: 'spin', icon: SPIN_ICON },
  model: { label: '3D model', tab: 'model', icon: ICONS.box },
  image: { label: 'Product image', tab: 'image', icon: ICONS.image },
};
// the last two tabs only appear when there is something in them
const TABS = [['', 'All assets', true], ['panorama', 'Panoramas', true], ['spin', 'Product photo sets', true], ['model', '3D models', false], ['image', 'Product images', false]];
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const SORTS = {
  recent: ['Recently added', (a, b) => (b.added - a.added) || byName(a, b)],
  name: ['Name A–Z', byName],
  largest: ['Largest first', (a, b) => (b.size - a.size) || byName(a, b)],
  smallest: ['Smallest first', (a, b) => (a.size - b.size) || byName(a, b)],
};

let unbindMenus = null; // the page draws itself again after an upload or a delete

export async function render(el, { user, saved }) {
  unbindMenus?.(); unbindMenus = null;
  el.innerHTML = '<div class="loading">Loading assets…</div>';
  const [files, projects, lib] = await Promise.all([listAssets(), loadAllProjects(), loadLibrary()]);
  const total = files.reduce((a, f) => a + f.size, 0);
  const users = (it) => {
    const out = projects.filter((p) => isReferenced(it.path, referenced(p))).map((p) => ({
      title: p.title, href: `#/project/${encodeURIComponent(p.id)}`,
      opens: [p.draft, p.published].some((v) => v?.action?.folder === it.key), // this set is the open / close photos
    }));
    lib.products.filter((x) => x.image === it.path).forEach((x) => out.push({ title: x.name, href: `#/library/${encodeURIComponent(x.id)}` }));
    return out;
  };
  const canDelete = (it) => it.path.startsWith('media/assets/') || user.role === 'admin';
  const items = group(files).map((it) => {
    const used = users(it);
    // a photo set is called after the project it belongs to; files keep their file name
    const titled = it.kind === 'spin' && used.length > 0;
    const name = titled ? `${used[0].title}${used[0].opens ? ' — open / close' : ''}`
      : it.kind === 'spin' ? it.key.split('/').slice(-2).join('/')
      : it.path.split('/').pop();
    return { ...it, used, titled, name, added: addedAt(it) };
  });
  const inTab = (tab) => items.filter((it) => !tab || TYPES[it.type].tab === tab);
  const tabs = TABS.filter(([tab, , always]) => always || inTab(tab).length);
  const typesHere = Object.keys(TYPES).filter((t) => items.some((it) => it.type === t));

  el.innerHTML = `
    <div class="page-head lib-head">
      <div>
        <h1>Asset Library</h1>
        <p class="ws-sub">Manage panoramas, product photos and shared media.</p>
      </div>
      <div class="actions">
        <a class="btn btn--ghost" href="../capture/" target="_blank" rel="noopener">Capture with phone ↗</a>
        <label class="btn">+ Upload<input type="file" id="upload" accept="image/*" multiple hidden></label>
      </div>
    </div>
    <div class="usage as-usage">
      <div class="usage-bar"><i style="width:${Math.min(100, (total / LIMIT) * 100).toFixed(1)}%"></i></div>
      <span>${mb(total)} of 1 GB used (GitHub Pages limit)</span>
    </div>
    <div class="as-tabs" role="group" aria-label="Show">
      ${tabs.map(([tab, label], i) => `<button type="button" data-tab="${tab}" aria-pressed="${i === 0}">${label} (${inTab(tab).length})</button>`).join('')}
    </div>
    <div class="lib-tools as-tools">
      <label class="pj-search">${ICONS.search}<input class="input" id="q" type="search" placeholder="Search assets by name" aria-label="Search assets"></label>
      <select class="select" id="type" aria-label="Type"><option value="">All types</option>${typesHere.map((t) => `<option value="${t}">${TYPES[t].label}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="unused"> Only unused</label>
      <select class="select as-sort" id="sort" aria-label="Sort by">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</select>
      <p class="lib-count" id="count" aria-live="polite"></p>
    </div>
    <div class="progress" id="progress" hidden><i></i></div>
    <div id="list"></div>`;

  const $ = (s) => el.querySelector(s);
  let tab = '';

  const usedLine = (it) => {
    if (!it.used.length) return '<em>Unused</em>';
    // the set already carries the project's name, so the line only says how many
    if (it.titled) return it.used.length === 1 ? `<a href="${it.used[0].href}">Used in 1 project</a>` : `Used in ${it.used.length} projects`;
    return `Used in ${it.used.map((u) => `<a href="${u.href}">${esc(u.title)}</a>`).join(', ')}`;
  };
  const card = (it) => {
    const t = TYPES[it.type];
    const full = mediaURL(it.kind === 'spin' ? it.cover : it.path);
    return `
      <li class="as-card">
        ${it.cover
          ? `<a class="as-card-img" href="${esc(full)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${esc(mediaURL(it.cover))}" alt="" loading="lazy"></a>`
          : '<div class="as-card-img as-card-img--3d" aria-hidden="true">3D</div>'}
        <div class="as-card-body">
          <h3 class="${it.titled ? 'is-title' : ''}" title="${esc(it.path)}">${esc(it.name)}</h3>
          <span class="as-chip as-chip--${it.type}">${t.icon}${t.label}</span>
          <p class="as-size">${it.kind === 'spin' ? `${it.files.length} photos · ` : ''}${mb(it.size)}</p>
          <p class="as-used">${usedLine(it)}</p>
          <details class="ws-menu as-menu">
            <summary aria-label="More actions for ${esc(it.name)}"><span aria-hidden="true">⋮</span></summary>
            <div class="ws-menu-list">
              <a href="${esc(full)}" target="_blank" rel="noopener">${it.kind === 'model' ? 'Download file' : it.kind === 'spin' ? 'View first photo ↗' : 'View full size ↗'}</a>
              ${it.used.slice(0, 3).map((u) => `<a href="${u.href}">Open “${esc(u.title)}”</a>`).join('')}
              ${it.used.length ? '<span class="as-menu-note">In use, so it can’t be deleted</span>'
                : canDelete(it) ? `<button type="button" class="ws-menu-danger" data-del="${esc(it.key)}">Delete</button>`
                : '<span class="as-menu-note">Only an admin can delete this</span>'}
            </div>
          </details>
        </div>
      </li>`;
  };

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(), type = $('#type').value, onlyUnused = $('#unused').checked;
    const list = inTab(tab)
      .filter((it) => (!type || it.type === type) && (!onlyUnused || !it.used.length))
      .filter((it) => !q || it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q))
      .sort(SORTS[$('#sort').value][1]);
    el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    $('#count').textContent = `${list.length} asset${list.length === 1 ? '' : 's'}`;
    $('#list').innerHTML = list.length ? `<ul class="as-grid">${list.map(card).join('')}</ul>`
      : `<div class="empty">${items.length ? 'No assets match.' : 'No assets yet. Press <b>+ Upload</b>, or capture a panorama with a phone.'}</div>`;
  };
  $('.as-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    const type = $('#type');
    if (type.value && tab && TYPES[type.value].tab !== tab) type.value = ''; // a type from another tab would show nothing
    draw();
  });
  ['#q', '#type', '#unused', '#sort'].forEach((s) => $(s).addEventListener('input', draw));
  draw();
  unbindMenus = bindMenus(el);

  let deleting = false;
  $('#list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b || deleting) return;
    const it = items.find((x) => x.key === b.dataset.del);
    if (!it || !confirm(`Delete ${it.kind === 'spin' ? `the ${it.files.length} photos in “${it.name}”` : it.name}? This cannot be undone.`)) return;
    deleting = true;
    b.disabled = true;
    b.textContent = 'Deleting…';
    try { await deleteAssets(it.files); saved(); toast('Deleted'); render(el, { user, saved }); }
    catch (err) { deleting = false; b.disabled = false; b.textContent = 'Delete'; toast(err.message, true); }
  });

  $('#upload').addEventListener('change', async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    const bar = $('#progress');
    bar.hidden = false;
    try {
      const put = [];
      for (const f of list) {
        const prep = await preparePanorama(f); // resizes very large images; also makes a thumbnail
        const base = `media/assets/${slugify(f.name.replace(/\.[^.]+$/, '')) || 'image'}-${Date.now().toString(36)}`;
        put.push({ path: `${base}.jpg`, content: prep.file.type === 'image/jpeg' ? prep.file : await toJpeg(prep.file) });
        if (!prep.warning) put.push({ path: `${base}.thumb.jpg`, content: prep.thumb }); // 2:1 panoramas get a small preview
      }
      await uploadAssets(put, (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; });
      saved();
      toast(`${list.length} file${list.length > 1 ? 's' : ''} uploaded`);
      render(el, { user, saved });
    } catch (err) { toast(err.message, true); bar.hidden = true; }
  });
  return { destroy() { unbindMenus?.(); unbindMenus = null; } };
}

async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}
