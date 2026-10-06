// Product Library — the product information shown with 360° views
import { loadLibrary, loadIndex, saveLibraryProduct, deleteLibraryProduct, mediaURL } from '../store.js';
import { SERIES } from '../config.js';
import { esc, toast, slugify, uniqueId, busy, timeAgo } from '../ui.js';
import { ICONS, bindMenus } from './common.js';

async function toJpeg(file, max = 1200) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
}

export async function render(el, { param, go, saved }) {
  const [lib, index] = await Promise.all([loadLibrary(), loadIndex()]);
  const usedBy = (id) => index.projects.filter((p) => p.productId === id || p.published?.productId === id);
  return param ? renderEditor(el, { lib, usedBy, param, go, saved }) : renderList(el, { lib, usedBy, go, saved });
}

/** Page title, a line of description and the Products | Photos tabs — shared by both tabs.
 *  `count` (the number of products) is shown on the Products tab when it is known. */
export function libraryTabs(active, actions = '', count = null) {
  return `
    <div class="page-head lib-head">
      <div>
        <h1>Product Library</h1>
        <p class="ws-sub">Manage reusable product details and images.</p>
      </div>
      <div class="actions">${actions}</div>
    </div>
    <nav class="tabs" aria-label="Product Library">
      <a href="#/library" ${active === 'products' ? 'aria-current="page"' : ''}>Products${count == null ? '' : ` (${count})`}</a>
      <a href="#/photos" ${active === 'photos' ? 'aria-current="page"' : ''}>Photos</a>
    </nav>`;
}

const VIEW_KEY = 'js360-library-view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window: the choice just isn't remembered */ } };
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const SORTS = {
  updated: ['Recently updated', (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || byName(a, b)],
  name: ['Name A–Z', byName],
  series: ['Series', (a, b) => (a.series || '~').localeCompare(b.series || '~') || byName(a, b)],
};

function renderList(el, { lib, usedBy, go, saved }) {
  const all = lib.products;
  const seriesList = [...new Set(all.map((x) => x.series).filter(Boolean))].sort();
  let view = readView();

  el.innerHTML = `
    ${libraryTabs('products', '<a class="btn" href="#/library/new">+ Add product</a>', all.length)}
    <div class="lib-tools">
      <label class="pj-search">${ICONS.search}<input class="input" id="q" type="search" placeholder="Search by name, SKU or series" aria-label="Search products"></label>
      <select class="select" id="series" aria-label="Series">
        <option value="">All series</option>${seriesList.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
      <select class="select" id="sort" aria-label="Sort by">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</select>
      <div class="lib-view" role="group" aria-label="View">
        <button type="button" data-view="grid" aria-label="Grid view">${ICONS.grid}</button>
        <button type="button" data-view="list" aria-label="List view">${ICONS.list}</button>
      </div>
      <p class="lib-count" id="count" aria-live="polite"></p>
    </div>
    <div id="list"></div>`;

  const $ = (s) => el.querySelector(s);
  const usedText = (n) => (n ? `Used in ${n} project${n > 1 ? 's' : ''}` : 'Not used yet');
  const picture = (x) => (x.image ? `<img src="${esc(mediaURL(x.image))}" alt="" loading="lazy">` : '<span class="ws-noimg">No image</span>');
  const menu = (x, uses) => `
    <details class="ws-menu lib-menu">
      <summary aria-label="More actions for ${esc(x.name)}"><span aria-hidden="true">⋮</span></summary>
      <div class="ws-menu-list">
        ${x.sku ? `<a href="#/photos/${encodeURIComponent(x.sku)}">Photos for this SKU</a>` : ''}
        ${uses.slice(0, 3).map((p) => `<a href="#/project/${encodeURIComponent(p.id)}">Open “${esc(p.title)}”</a>`).join('')}
        <button type="button" class="ws-menu-danger" data-delete-product="${esc(x.id)}">Delete</button>
      </div>
    </details>`;
  const row = (x) => {
    const uses = usedBy(x.id), open = `#/library/${encodeURIComponent(x.id)}`;
    return `
      <div class="lib-row" role="row">
        <div class="lib-product" role="cell">
          <a class="lib-thumb" href="${open}" tabindex="-1" aria-hidden="true">${picture(x)}</a>
          <div><h3><a href="${open}">${esc(x.name)}</a></h3>${x.sku ? `<span class="sku">${esc(x.sku)}</span>` : ''}</div>
        </div>
        <div role="cell" data-label="Series">${esc(x.series || '—')}</div>
        <div role="cell" data-label="Projects">${usedText(uses.length)}</div>
        <div role="cell" data-label="Last updated">${x.updatedAt ? timeAgo(x.updatedAt) : '—'}</div>
        <div class="lib-actions" role="cell"><a class="btn btn--ghost btn--sm" href="${open}">View / edit</a>${menu(x, uses)}</div>
      </div>`;
  };
  const card = (x) => {
    const uses = usedBy(x.id), open = `#/library/${encodeURIComponent(x.id)}`;
    return `
      <li class="pj-card">
        <a class="pj-card-img lib-card-img" href="${open}" tabindex="-1" aria-hidden="true">${picture(x)}</a>
        ${menu(x, uses)}
        <div class="pj-card-body">
          <h3><a href="${open}">${esc(x.name)}</a></h3>
          <div class="ws-meta">${x.sku ? `<span class="sku">${esc(x.sku)}</span>` : ''}<span>${esc(x.series || '—')}</span>${x.price ? `<span>${esc(x.price)}</span>` : ''}</div>
          <div class="ws-meta"><span>${usedText(uses.length)}${x.updatedAt ? ` · ${timeAgo(x.updatedAt)}` : ''}</span></div>
          <a class="pj-open" href="${open}">View / edit <span aria-hidden="true">→</span></a>
        </div>
      </li>`;
  };

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(), series = $('#series').value;
    const list = all.filter((x) => (!q || `${x.name} ${x.series || ''} ${x.sku || ''}`.toLowerCase().includes(q)) && (!series || x.series === series))
      .sort(SORTS[$('#sort').value][1]);
    el.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    $('#count').textContent = list.length === all.length ? `${all.length} product${all.length === 1 ? '' : 's'}` : `${list.length} of ${all.length} products`;
    if (!list.length) {
      $('#list').innerHTML = `<div class="empty">${all.length ? 'No products match.' : 'No products yet. <a href="#/library/new">Add the first one</a>.'}</div>`;
    } else if (view === 'grid') {
      $('#list').innerHTML = `<ul class="pj-grid">${list.map(card).join('')}</ul>`;
    } else {
      $('#list').innerHTML = `
        <div class="lib-table" role="table" aria-label="Products">
          <div class="lib-row lib-row--head" role="row">
            <div role="columnheader">Product</div><div role="columnheader">Series</div><div role="columnheader">Projects</div>
            <div role="columnheader">Last updated</div><div role="columnheader">Actions</div>
          </div>
          ${list.map(row).join('')}
        </div>`;
    }
  };
  ['#q', '#series', '#sort'].forEach((s) => $(s).addEventListener('input', draw));
  $('.lib-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    saveView(view);
    draw();
  });

  let deleting = false;
  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-product]');
    if (!btn || deleting) return;
    const x = all.find((y) => y.id === btn.dataset.deleteProduct);
    const uses = usedBy(x.id);
    if (uses.length) { toast(`This product is used in ${uses.length} project${uses.length > 1 ? 's' : ''}. Change ${uses.length > 1 ? 'those projects' : 'that project'} first.`, true); return; }
    if (!confirm(`Delete "${x.name}" from the library?`)) return;
    deleting = true;
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try { await deleteLibraryProduct(x); saved(); toast('Product deleted'); go('#/library'); }
    catch (err) { btn.disabled = false; btn.textContent = 'Delete'; toast(err.message, true); }
    finally { deleting = false; }
  });

  draw();
  return { destroy: bindMenus(el) };
}

function renderEditor(el, { lib, usedBy, param, go, saved }) {
  const isNew = param === 'new';
  const original = isNew ? null : lib.products.find((x) => x.id === param);
  if (!isNew && !original) throw new Error('This product is not in the library.');
  const x = structuredClone(original || { id: '', name: '', sku: '', series: '', price: '', description: '', image: '' });
  let image = null, dirty = false;
  const uses = isNew ? [] : usedBy(x.id);

  el.innerHTML = `
    <div class="page-head">
      <div><a class="link-btn" href="#/library">← Product Library</a><h1>${isNew ? 'Add product' : esc(x.name)}</h1></div>
      <div class="actions">
        ${isNew ? '' : '<button class="btn btn--danger btn--sm" type="button" id="delete">Delete</button>'}
        <button class="btn" type="button" id="save">Save</button>
      </div>
    </div>
    <div class="editor">
      <section class="panel">
        <div class="row">
          <div class="field"><label for="name">Product name *</label><input class="input" id="name" value="${esc(x.name)}" maxlength="100"></div>
          <div class="field"><label for="sku">SKU</label><input class="input" id="sku" value="${esc(x.sku || '')}" maxlength="40" placeholder="e.g. JS1023-BRN">
            ${x.sku ? `<span class="hint"><a href="#/photos/${encodeURIComponent(x.sku)}">See photos for this SKU →</a></span>` : ''}</div>
        </div>
        <div class="row">
          <div class="field"><label for="series">Series</label><input class="input" id="series" list="series-list" value="${esc(x.series)}">
            <datalist id="series-list">${SERIES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
          <div class="field"><label for="price">Price <span class="sub-inline">optional</span></label><input class="input" id="price" value="${esc(x.price)}" placeholder="RM 299"></div>
        </div>
        <div class="field"><label for="desc">Description</label><textarea class="textarea" id="desc">${esc(x.description)}</textarea></div>
      </section>
      <section class="panel">
        <h2>Image</h2>
        <p class="sub">Shown in the showroom product card and the product list.</p>
        <div class="lib-image" id="img">${x.image ? `<img src="${esc(mediaURL(x.image))}" alt="">` : '<div class="ph">No image</div>'}</div>
        <label class="btn btn--ghost btn--sm" style="margin-top:12px">Choose image<input type="file" id="file" accept="image/*" hidden></label>
        ${uses.length ? `<h2 style="margin-top:20px">Used in</h2><ul class="uses">${uses.map((p) => `<li><a href="#/project/${encodeURIComponent(p.id)}">${esc(p.title)}</a></li>`).join('')}</ul>` : ''}
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  ['#name', '#sku', '#series', '#price', '#desc'].forEach((s) => $(s).addEventListener('input', () => { dirty = true; }));
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    image = await toJpeg(f);
    $('#img').innerHTML = `<img src="${URL.createObjectURL(image)}" alt="">`;
    dirty = true;
  });

  $('#save').addEventListener('click', () => busy($('#save'), 'Saving…', async () => {
    x.name = $('#name').value.trim();
    if (!x.name) { toast('Enter the product name', true); return; }
    x.sku = $('#sku').value.trim().toUpperCase().replace(/\s+/g, '-');
    x.series = $('#series').value.trim();
    x.price = $('#price').value.trim();
    x.description = $('#desc').value.trim();
    if (isNew) x.id = uniqueId(slugify(x.name) || 'product', new Set(['new', ...lib.products.map((y) => y.id)]));
    try {
      await saveLibraryProduct(x, image, original?.image);
      dirty = false;
      saved();
      toast('Product saved');
      go('#/library');
    } catch (err) { toast(err.message, true); }
  }));

  $('#delete')?.addEventListener('click', () => {
    if (uses.length) { toast(`This product is used in ${uses.length} project(s). Change those projects first.`, true); return; }
    if (!confirm(`Delete "${x.name}" from the library?`)) return;
    busy($('#delete'), 'Deleting…', async () => {
      try { await deleteLibraryProduct(original); dirty = false; saved(); toast('Product deleted'); go('#/library'); }
      catch (err) { toast(err.message, true); }
    });
  });

  return { isDirty: () => dirty };
}
