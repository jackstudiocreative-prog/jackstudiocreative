// Product Library — the product information shown with 360° views
import { loadLibrary, loadIndex, saveLibraryProduct, deleteLibraryProduct, mediaURL } from '../store.js';
import { SERIES } from '../config.js';
import { esc, toast, slugify, uniqueId, busy } from '../ui.js';

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
  return param ? renderEditor(el, { lib, usedBy, param, go, saved }) : renderList(el, { lib, usedBy });
}

function renderList(el, { lib, usedBy }) {
  el.innerHTML = `
    <div class="page-head">
      <h1>Product Library</h1>
      <div class="actions"><a class="btn" href="#/library/new">+ Add product</a></div>
    </div>
    <input class="input filter-one" id="q" type="search" placeholder="Search products" aria-label="Search products">
    <div id="list"></div>`;
  const draw = () => {
    const q = el.querySelector('#q').value.trim().toLowerCase();
    const list = lib.products.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.series || '').toLowerCase().includes(q));
    el.querySelector('#list').innerHTML = list.length ? `<ul class="grid" style="list-style:none;margin:0;padding:0">${list.map((x) => {
      const n = usedBy(x.id).length;
      return `<li><a class="item" href="#/library/${encodeURIComponent(x.id)}">
        ${x.image ? `<img src="${esc(mediaURL(x.image))}" alt="" loading="lazy">` : '<div class="ph">No image</div>'}
        <div class="body"><h3>${esc(x.name)}</h3><div class="meta"><span>${esc(x.series || '—')}</span>${x.price ? `<span>${esc(x.price)}</span>` : ''}</div>
        <div class="meta"><span>${n ? `Used in ${n} project${n > 1 ? 's' : ''}` : 'Not used yet'}</span></div></div>
      </a></li>`;
    }).join('')}</ul>` : `<div class="empty">${lib.products.length ? 'No products match.' : 'No products yet. <a href="#/library/new">Add the first one</a>.'}</div>`;
  };
  el.querySelector('#q').addEventListener('input', draw);
  draw();
  return {};
}

function renderEditor(el, { lib, usedBy, param, go, saved }) {
  const isNew = param === 'new';
  const original = isNew ? null : lib.products.find((x) => x.id === param);
  if (!isNew && !original) throw new Error('This product is not in the library.');
  const x = structuredClone(original || { id: '', name: '', series: '', price: '', description: '', image: '' });
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
        <div class="field"><label for="name">Product name *</label><input class="input" id="name" value="${esc(x.name)}" maxlength="100"></div>
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
  ['#name', '#series', '#price', '#desc'].forEach((s) => $(s).addEventListener('input', () => { dirty = true; }));
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
