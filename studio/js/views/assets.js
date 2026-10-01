// Asset Library — every photo, panorama and 3D model in the repository
import { listAssets, loadAllProjects, loadLibrary, uploadAssets, deleteAssets, mediaURL, referenced, isReferenced } from '../store.js';
import { preparePanorama } from '../media-tools.js';
import { esc, toast, slugify, busy } from '../ui.js';

const LIMIT = 1024 ** 3; // GitHub Pages site limit (1 GB)
const mb = (n) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;

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
      const g = spins.get(m[1]) || { kind: 'spin', key: m[1], path: `${m[1]}/`, files: [], size: 0, cover: f.path };
      g.files.push(f.path); g.size += f.size;
      if (f.path < g.cover) g.cover = f.path;
      spins.set(m[1], g);
      continue;
    }
    const kind = /\.(glb|usdz)$/i.test(f.path) ? 'model'
      : f.path.startsWith('media/library/') ? 'image'
      : 'panorama';
    const thumb = thumbFor(f.path);
    groups.push({ kind, key: f.path, path: f.path, files: [f.path, ...(thumb ? [thumb] : [])], size: f.size, cover: kind === 'model' ? '' : thumb || f.path });
  }
  return [...groups, ...spins.values()];
}

const KINDS = [
  ['panorama', 'Panoramas & photos'],
  ['spin', 'Product photo sets'],
  ['model', '3D models'],
  ['image', 'Product images'],
];

export async function render(el, { user, saved }) {
  el.innerHTML = '<div class="loading">Loading assets…</div>';
  const [files, projects, lib] = await Promise.all([listAssets(), loadAllProjects(), loadLibrary()]);
  const items = group(files);
  const total = files.reduce((a, f) => a + f.size, 0);
  const users = (path) => {
    const out = projects.filter((p) => isReferenced(path, referenced(p))).map((p) => ({ title: p.title, href: `#/project/${encodeURIComponent(p.id)}` }));
    lib.products.filter((x) => x.image === path).forEach((x) => out.push({ title: x.name, href: `#/library/${encodeURIComponent(x.id)}` }));
    return out;
  };
  const canDelete = (it) => it.path.startsWith('media/assets/') || user.role === 'admin';

  el.innerHTML = `
    <div class="page-head">
      <h1>Asset Library</h1>
      <div class="actions">
        <a class="btn btn--ghost btn--sm" href="../capture/" target="_blank" rel="noopener">Capture with phone ↗</a>
        <label class="btn">+ Upload<input type="file" id="upload" accept="image/*" multiple hidden></label>
      </div>
    </div>
    <div class="usage">
      <div class="usage-bar"><i style="width:${Math.min(100, (total / LIMIT) * 100).toFixed(1)}%"></i></div>
      <span>${mb(total)} of 1 GB used (GitHub Pages limit)</span>
    </div>
    <div class="filters">
      <select class="select" id="kind" aria-label="Type"><option value="">All types</option>${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="unused"> Only unused</label>
    </div>
    <div class="progress" id="progress" hidden><i></i></div>
    <div id="list"></div>`;

  const $ = (s) => el.querySelector(s);
  const draw = () => {
    const kind = $('#kind').value, onlyUnused = $('#unused').checked;
    $('#list').innerHTML = KINDS.filter(([k]) => !kind || k === kind).map(([k, label]) => {
      const list = items.filter((it) => it.kind === k).map((it) => ({ ...it, used: users(it.path) })).filter((it) => !onlyUnused || !it.used.length);
      if (!list.length) return '';
      return `<section class="home-block"><div class="block-head"><h2>${label}</h2><span class="status">${list.length}</span></div>
        <ul class="asset-grid">${list.map((it) => `
          <li class="asset">
            ${it.cover ? `<img src="${esc(mediaURL(it.cover))}" alt="" loading="lazy" class="${k === 'panorama' ? 'wide' : ''}">` : '<div class="ph">3D</div>'}
            <div class="asset-body">
              <b title="${esc(it.path)}">${esc(it.kind === 'spin' ? it.key.split('/').slice(-2).join('/') : it.path.split('/').pop())}</b>
              <span>${it.kind === 'spin' ? `${it.files.length} frames · ` : ''}${mb(it.size)}</span>
              <span>${it.used.length ? `Used in ${it.used.map((u) => `<a href="${u.href}">${esc(u.title)}</a>`).join(', ')}` : '<em>Unused</em>'}</span>
              ${!it.used.length && canDelete(it) ? `<button class="link-btn danger" type="button" data-del="${esc(it.key)}">Delete</button>` : ''}
            </div>
          </li>`).join('')}</ul></section>`;
    }).join('') || '<div class="empty">No assets match.</div>';
    $('#list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const it = items.find((x) => x.key === b.dataset.del);
      if (!confirm(`Delete ${it.kind === 'spin' ? `${it.files.length} photos` : it.path.split('/').pop()}? This cannot be undone.`)) return;
      busy(b, 'Deleting…', async () => {
        try { await deleteAssets(it.files); saved(); toast('Deleted'); render(el, { user, saved }); }
        catch (err) { toast(err.message, true); }
      });
    }));
  };
  ['#kind', '#unused'].forEach((s) => $(s).addEventListener('input', draw));
  draw();

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
  return {};
}

async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}
