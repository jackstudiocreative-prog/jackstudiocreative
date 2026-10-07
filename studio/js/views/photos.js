// Photos — the private product photo library: upload originals by SKU, search, preview, download
import { photoLibraryState, createPhotoLibrary, syncPhotoAccess } from '../github.js';
import { REPO, PHOTOS_REPO } from '../config.js';
import { loadLibrary } from '../store.js';
import {
  loadPhotoIndex, uploadPhotos, updatePhotos, deletePhotos, thumbURL, original, makeThumb,
  normalizeSku, skuFromFileName, MAX_FILE,
} from '../photos-store.js';
import { makeZip, saveBlob } from '../zip.js';
import { esc, toast, busy, timeAgo } from '../ui.js';
import { libraryTabs } from './library.js';

const fmt = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const RECOMMENDED = 5 * 1024 ** 3;
const GROUPS_PER_PAGE = 40;

export async function render(el, { user, param, saved }) {
  el.innerHTML = `${libraryTabs('photos')}<div id="body"><div class="loading">Checking the photo library…</div></div>`;
  const body = el.querySelector('#body');
  const state = await photoLibraryState(user);

  if (state === 'missing') {
    const isOwner = user.login.toLowerCase() === REPO.owner.toLowerCase();
    body.innerHTML = `
      <section class="panel narrow">
        <h2>Set up the photo library</h2>
        <p class="sub">Product photos are kept in a separate <b>private</b> GitHub repository (<code>${esc(PHOTOS_REPO)}</code>), so only the team can see them and they don't use the website's 1 GB.</p>
        ${isOwner
          ? '<button class="btn" type="button" id="setup">Set up photo library</button><p class="status" id="setup-status"></p>'
          : `<p class="sub">Only the account owner (<b>${esc(REPO.owner)}</b>) can set this up. Ask them to open <b>Product Library → Photos</b> in the Studio.</p>`}
      </section>`;
    body.querySelector('#setup')?.addEventListener('click', (e) => busy(e.currentTarget, 'Setting up…', async () => {
      try {
        await createPhotoLibrary((t) => { body.querySelector('#setup-status').textContent = t; });
        toast('Photo library ready');
        render(el, { user, param, saved });
      } catch (err) { toast(err.message, true); }
    }));
    return {};
  }

  if (state === 'not-connected') {
    // signed in with a Studio account: the sign-in service's GitHub App has to be installed on the photo repository too
    body.innerHTML = `
      <section class="panel narrow">
        <h2>The photo library is not connected yet</h2>
        <p class="sub">Staff accounts can use the photo library once the owner has connected it. This is done once, on GitHub:</p>
        <ol class="sub">
          <li>Sign in to GitHub as <b>${esc(REPO.owner)}</b> and open <a href="https://github.com/settings/installations" target="_blank" rel="noopener">Settings → Applications</a>.</li>
          <li>Next to <b>Jack Studio 360 Sign-in</b> press <b>Configure</b>.</li>
          <li>Under <b>Repository access</b>, add <b>${esc(PHOTOS_REPO)}</b> and press <b>Save</b>.</li>
        </ol>
        <p class="sub">No repository called ${esc(PHOTOS_REPO)}? Then the photo library has not been set up: the owner signs in to the Studio with their GitHub key and opens this page first.</p>
        <button class="btn btn--ghost btn--sm" type="button" id="retry">Check again</button>
      </section>`;
    body.querySelector('#retry').addEventListener('click', (e) => busy(e.currentTarget, 'Checking…', async () => {
      await photoLibraryState(user, true); // fetches a fresh key, which includes the photo library once it is connected
      render(el, { user, param, saved });
    }));
    return {};
  }

  if (state === 'no-access') {
    body.innerHTML = `
      <section class="panel narrow">
        <h2>Accept your photo library invitation</h2>
        <p class="sub">The photo library is private. GitHub has sent you a separate invitation for it.</p>
        <ol class="sub">
          <li>Open <a href="https://github.com/${esc(REPO.owner)}/${esc(PHOTOS_REPO)}/invitations" target="_blank" rel="noopener">your invitation on GitHub</a> (or the invitation email) and press <b>Accept invitation</b>.</li>
          <li>Come back here and reload the page.</li>
        </ol>
        <p class="sub">No invitation? Ask an admin to open <b>Team</b> and press <b>Give everyone photo access</b>.</p>
        <button class="btn btn--ghost btn--sm" type="button" id="retry">I've accepted — check again</button>
      </section>`;
    body.querySelector('#retry').addEventListener('click', () => render(el, { user, param, saved }));
    return {};
  }

  return renderLibrary(body, { user, param, rerender: () => render(el, { user, param, saved }) });
}

async function renderLibrary(el, { user, param, rerender }) {
  const [index, lib] = await Promise.all([loadPhotoIndex(), loadLibrary()]);
  const all = index.photos;
  const bySku = new Map(lib.products.filter((p) => p.sku).map((p) => [normalizeSku(p.sku), p]));
  const selected = new Set();
  let shownGroups = GROUPS_PER_PAGE;
  let pending = [];
  const total = all.reduce((a, p) => a + (p.size || 0), 0);
  const canDelete = (p) => user.role === 'admin' || p.uploadedBy === user.login;

  el.innerHTML = `
    <div class="photo-toolbar">
      <input class="input" id="q" type="search" placeholder="Search by SKU, product name, file name or tag" aria-label="Search photos" value="${esc(param || '')}">
      <label class="btn">+ Upload photos<input type="file" id="files" accept="image/*,.heic,.heif" multiple hidden></label>
    </div>
    <div class="usage">
      <div class="usage-bar"><i style="width:${Math.min(100, (total / RECOMMENDED) * 100).toFixed(1)}%"></i></div>
      <span>${all.length} photos · ${fmt(total)} of about 5 GB recommended for one GitHub repository</span>
    </div>

    <section class="panel upload-panel" id="upload" hidden>
      <div class="block-head"><h2>Upload <span id="up-count"></span></h2><button class="link-btn" type="button" id="up-cancel">Cancel</button></div>
      <p class="sub">Originals are stored unchanged (max ${fmt(MAX_FILE)} each). Give every photo its SKU so it can be found later.</p>
      <div class="inline up-bulk">
        <input class="input" id="bulk-sku" placeholder="SKU for all photos, e.g. JS1023-BRN">
        <button class="btn btn--ghost btn--sm" type="button" id="bulk-apply">Apply to all</button>
        <button class="btn btn--ghost btn--sm" type="button" id="bulk-detect">Use SKU from file names</button>
        <input class="input" id="bulk-tags" placeholder="Tags for all (optional, comma separated)">
      </div>
      <ul class="up-list" id="up-list"></ul>
      <div class="progress" id="up-progress" hidden><i></i></div>
      <div class="inline"><button class="btn" type="button" id="up-start">Upload</button><span class="status" id="up-status"></span></div>
    </section>

    <div id="results"></div>
    <div class="select-bar" id="select-bar" hidden>
      <span id="sel-info"></span>
      <button class="btn btn--sm" type="button" id="sel-download">Download</button>
      <button class="btn btn--danger btn--sm" type="button" id="sel-delete">Delete</button>
      <button class="link-btn" type="button" id="sel-clear">Clear</button>
    </div>
    <dialog class="lightbox" id="lightbox"></dialog>`;

  const $ = (s) => el.querySelector(s);

  /* ---------- search & results ---------- */
  const matches = (p, q) => {
    if (!q) return true;
    const prod = bySku.get(p.sku);
    const hay = `${p.sku} ${p.name} ${(p.tags || []).join(' ')} ${prod?.name || ''} ${prod?.series || ''}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  };

  function filtered() {
    const q = $('#q').value.trim();
    const list = all.filter((p) => matches(p, q));
    // exact SKU matches first
    const groups = new Map();
    list.forEach((p) => { if (!groups.has(p.sku)) groups.set(p.sku, []); groups.get(p.sku).push(p); });
    const qs = normalizeSku(q);
    return [...groups.entries()].sort((a, b) => (b[0] === qs) - (a[0] === qs) || a[0].localeCompare(b[0]));
  }

  function draw() {
    const groups = filtered();
    const count = groups.reduce((a, [, l]) => a + l.length, 0);
    if (!all.length) {
      $('#results').innerHTML = '<div class="empty">No photos yet. Press <b>Upload photos</b> to add the first ones.</div>';
      return;
    }
    $('#results').innerHTML = `<p class="status">${count} photo${count === 1 ? '' : 's'} in ${groups.length} SKU${groups.length === 1 ? '' : 's'}</p>${groups.slice(0, shownGroups).map(([sku, list]) => {
      const prod = bySku.get(sku);
      return `<section class="sku-group" data-sku="${esc(sku)}">
        <div class="sku-head">
          <div><b class="sku">${esc(sku)}</b>${prod ? `<span>${esc(prod.name)}${prod.series ? ` · ${esc(prod.series)}` : ''}</span>` : ''}<span class="status">${list.length} photo${list.length === 1 ? '' : 's'}</span></div>
          <div class="inline">
            <button class="link-btn" type="button" data-select-group="${esc(sku)}">Select all</button>
            <button class="btn btn--ghost btn--sm" type="button" data-download-group="${esc(sku)}">Download all</button>
          </div>
        </div>
        <ul class="photo-grid">${list.map((p) => `
          <li class="photo ${selected.has(p.id) ? 'is-selected' : ''}" data-id="${esc(p.id)}">
            <button type="button" class="photo-open" data-open="${esc(p.id)}" aria-label="Open ${esc(p.name)}">
              <span class="photo-img" data-thumb="${esc(p.id)}">${p.thumb ? '' : `<span class="ph">${esc((p.name.split('.').pop() || '').toUpperCase())}</span>`}</span>
            </button>
            <label class="photo-check"><input type="checkbox" data-check="${esc(p.id)}" ${selected.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)}"></label>
            <div class="photo-meta"><span title="${esc(p.name)}">${esc(p.name)}</span><span>${fmt(p.size)}${p.width ? ` · ${p.width}×${p.height}` : ''}</span></div>
          </li>`).join('')}</ul>
      </section>`;
    }).join('')}${groups.length > shownGroups ? '<button class="btn btn--ghost" type="button" id="more">Show more</button>' : ''}${!groups.length ? '<div class="empty">No photos match this search.</div>' : ''}`;
    loadThumbs();
    $('#more')?.addEventListener('click', () => { shownGroups += GROUPS_PER_PAGE; draw(); });
  }

  // previews load as they scroll into view
  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const p = all.find((x) => x.id === e.target.dataset.thumb);
      const url = p && (await thumbURL(p).catch(() => null));
      if (url) e.target.innerHTML = `<img src="${url}" alt="">`;
    });
  }, { rootMargin: '300px' });
  const loadThumbs = () => el.querySelectorAll('[data-thumb]').forEach((n) => { if (!n.querySelector('img') && !n.querySelector('.ph')) io.observe(n); });

  let qTimer;
  $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { shownGroups = GROUPS_PER_PAGE; draw(); }, 150); });

  /* ---------- selection ---------- */
  function updateSelection() {
    const list = all.filter((p) => selected.has(p.id));
    $('#select-bar').hidden = !list.length;
    $('#sel-info').textContent = `${list.length} selected · ${fmt(list.reduce((a, p) => a + (p.size || 0), 0))}`;
    $('#sel-delete').hidden = !list.every(canDelete);
    el.querySelectorAll('.photo').forEach((n) => n.classList.toggle('is-selected', selected.has(n.dataset.id)));
  }

  $('#results').addEventListener('change', (e) => {
    const id = e.target.dataset.check;
    if (!id) return;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    updateSelection();
  });
  $('#results').addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-select-group],[data-download-group]');
    if (!t) return;
    if (t.dataset.open) openLightbox(t.dataset.open);
    if (t.dataset.selectGroup) {
      const ids = all.filter((p) => p.sku === t.dataset.selectGroup && matches(p, $('#q').value.trim())).map((p) => p.id);
      const allOn = ids.every((id) => selected.has(id));
      ids.forEach((id) => (allOn ? selected.delete(id) : selected.add(id)));
      el.querySelectorAll(`[data-sku="${CSS.escape(t.dataset.selectGroup)}"] [data-check]`).forEach((c) => { c.checked = !allOn; });
      updateSelection();
    }
    if (t.dataset.downloadGroup) {
      const list = all.filter((p) => p.sku === t.dataset.downloadGroup && matches(p, $('#q').value.trim()));
      busy(t, 'Preparing…', () => download(list, t.dataset.downloadGroup));
    }
  });
  $('#sel-clear').addEventListener('click', () => {
    selected.clear();
    el.querySelectorAll('[data-check]').forEach((c) => { c.checked = false; });
    updateSelection();
  });
  $('#sel-download').addEventListener('click', (e) => busy(e.currentTarget, 'Preparing…', () => download(all.filter((p) => selected.has(p.id)), 'photos')));
  $('#sel-delete').addEventListener('click', (e) => {
    const list = all.filter((p) => selected.has(p.id));
    if (!confirm(`Delete ${list.length} photo${list.length > 1 ? 's' : ''}? The originals are removed for everyone.`)) return;
    busy(e.currentTarget, 'Deleting…', async () => {
      try { await deletePhotos(list); toast('Deleted'); rerender(); } catch (err) { toast(err.message, true); }
    });
  });

  async function download(list, label) {
    try {
      if (list.length === 1) {
        saveBlob(await original(list[0]), list[0].name);
        return;
      }
      const files = [];
      for (let i = 0; i < list.length; i++) {
        $('#sel-info').textContent = `Downloading ${i + 1} of ${list.length}…`;
        files.push({ name: `${list[i].sku}/${list[i].name}`, blob: await original(list[i]) });
      }
      const zip = await makeZip(files);
      saveBlob(zip, `jackstudio-${label === 'photos' ? 'photos' : normalizeSku(label)}-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) { toast(`Download failed: ${err.message}`, true); }
    finally { updateSelection(); }
  }

  /* ---------- lightbox ---------- */
  let lbIndex = -1, lbUrl = null;
  const lb = $('#lightbox');
  function visibleList() { return filtered().flatMap(([, l]) => l); }

  async function openLightbox(id) {
    const list = visibleList();
    lbIndex = list.findIndex((p) => p.id === id);
    const p = list[lbIndex];
    if (!p) return;
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    const prod = bySku.get(p.sku);
    lb.innerHTML = `
      <div class="lb-inner">
        <div class="lb-stage" id="lb-stage"><div class="loading">Loading original…</div></div>
        <aside class="lb-side">
          <button class="lb-close" type="button" id="lb-close" aria-label="Close">×</button>
          <p class="status">${lbIndex + 1} of ${list.length}</p>
          <h2 class="lb-name" title="${esc(p.name)}">${esc(p.name)}</h2>
          ${prod ? `<p class="sub">${esc(prod.name)}${prod.series ? ` · ${esc(prod.series)}` : ''}</p>` : ''}
          <div class="field"><label for="lb-sku">SKU</label><input class="input" id="lb-sku" value="${esc(p.sku)}"></div>
          <div class="field"><label for="lb-tags">Tags</label><input class="input" id="lb-tags" value="${esc((p.tags || []).join(', '))}" placeholder="e.g. front, lifestyle, brown"></div>
          <dl class="lb-facts">
            <dt>Size</dt><dd>${fmt(p.size)}${p.width ? ` · ${p.width}×${p.height}px` : ''}</dd>
            <dt>Uploaded</dt><dd>${esc(p.uploadedBy)} · ${timeAgo(p.uploadedAt)}</dd>
          </dl>
          <div class="lb-actions">
            <button class="btn" type="button" id="lb-download">Download original</button>
            <button class="btn btn--ghost btn--sm" type="button" id="lb-save">Save changes</button>
            ${canDelete(p) ? '<button class="btn btn--danger btn--sm" type="button" id="lb-delete">Delete</button>' : ''}
          </div>
          <div class="lb-nav">
            <button class="btn btn--ghost btn--sm" type="button" id="lb-prev" ${lbIndex === 0 ? 'disabled' : ''}>← Previous</button>
            <button class="btn btn--ghost btn--sm" type="button" id="lb-next" ${lbIndex === list.length - 1 ? 'disabled' : ''}>Next →</button>
          </div>
        </aside>
      </div>`;
    if (!lb.open) lb.showModal();
    const q = (s) => lb.querySelector(s);
    q('#lb-close').addEventListener('click', () => lb.close());
    q('#lb-prev').addEventListener('click', () => openLightbox(list[lbIndex - 1].id));
    q('#lb-next').addEventListener('click', () => openLightbox(list[lbIndex + 1].id));
    q('#lb-download').addEventListener('click', (e) => busy(e.currentTarget, 'Downloading…', async () => {
      try { saveBlob(await original(p), p.name); } catch (err) { toast(err.message, true); }
    }));
    q('#lb-save').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
      const sku = normalizeSku(q('#lb-sku').value);
      if (!sku) { toast('Enter a SKU', true); return; }
      const tags = q('#lb-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
      try {
        await updatePhotos([p.id], { sku, tags });
        p.sku = sku; p.tags = tags;
        toast('Saved');
        draw();
      } catch (err) { toast(err.message, true); }
    }));
    q('#lb-delete')?.addEventListener('click', (e) => {
      if (!confirm(`Delete ${p.name}?`)) return;
      busy(e.currentTarget, 'Deleting…', async () => {
        try { await deletePhotos([p]); lb.close(); toast('Deleted'); rerender(); } catch (err) { toast(err.message, true); }
      });
    });
    // show the thumbnail immediately, then the full original
    const t = await thumbURL(p).catch(() => null);
    if (lbIndex >= 0 && visibleList()[lbIndex]?.id === p.id && t) q('#lb-stage').innerHTML = `<img src="${t}" alt="">`;
    try {
      const blob = await original(p);
      if (visibleList()[lbIndex]?.id !== p.id) return;
      lbUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { q('#lb-stage').innerHTML = ''; q('#lb-stage').append(img); };
      img.onerror = () => { if (!t) q('#lb-stage').innerHTML = '<p class="status">This file type can\'t be previewed in the browser, but you can download it.</p>'; };
      img.alt = p.name;
      img.src = lbUrl;
    } catch (err) { q('#lb-stage').innerHTML = `<p class="status">${esc(err.message)}</p>`; }
  }
  lb.addEventListener('keydown', (e) => {
    const list = visibleList();
    if (e.key === 'ArrowLeft' && lbIndex > 0) openLightbox(list[lbIndex - 1].id);
    if (e.key === 'ArrowRight' && lbIndex < list.length - 1) openLightbox(list[lbIndex + 1].id);
  });
  lb.addEventListener('close', () => { if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; } });

  /* ---------- upload ---------- */
  function renderPending() {
    $('#upload').hidden = !pending.length;
    $('#up-count').textContent = `${pending.length} photo${pending.length === 1 ? '' : 's'}`;
    $('#up-list').innerHTML = pending.map((it, i) => `
      <li>
        <span class="up-thumb">${it.preview ? `<img src="${it.preview}" alt="">` : '<span class="ph">…</span>'}</span>
        <span class="up-name" title="${esc(it.file.name)}">${esc(it.file.name)}<small>${fmt(it.file.size)}</small></span>
        <input class="input" data-sku="${i}" value="${esc(it.sku)}" placeholder="SKU" aria-label="SKU for ${esc(it.file.name)}">
        <button class="link-btn danger" type="button" data-drop="${i}" aria-label="Remove ${esc(it.file.name)}">×</button>
      </li>`).join('');
  }
  $('#files').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const tooBig = files.filter((f) => f.size > MAX_FILE);
    if (tooBig.length) toast(`${tooBig.length} file(s) over ${fmt(MAX_FILE)} skipped`, true);
    const add = files.filter((f) => f.size <= MAX_FILE).map((file) => ({ file, sku: normalizeSku($('#bulk-sku').value) || skuFromFileName(file.name), preview: null, thumbInfo: null }));
    pending.push(...add);
    renderPending();
    $('#upload').scrollIntoView({ behavior: 'smooth', block: 'start' });
    for (const it of add) {
      it.thumbInfo = await makeThumb(it.file);
      if (it.thumbInfo.thumb) it.preview = URL.createObjectURL(it.thumbInfo.thumb);
      renderPending();
    }
  });
  $('#up-list').addEventListener('input', (e) => { const i = e.target.dataset.sku; if (i != null) pending[i].sku = e.target.value; });
  $('#up-list').addEventListener('click', (e) => {
    const i = e.target.dataset.drop;
    if (i == null) return;
    pending.splice(Number(i), 1);
    renderPending();
  });
  $('#bulk-apply').addEventListener('click', () => { const s = normalizeSku($('#bulk-sku').value); if (!s) return toast('Type a SKU first', true); pending.forEach((it) => { it.sku = s; }); renderPending(); });
  $('#bulk-detect').addEventListener('click', () => { pending.forEach((it) => { it.sku = skuFromFileName(it.file.name); }); renderPending(); });
  $('#up-cancel').addEventListener('click', () => { pending = []; renderPending(); });
  $('#up-start').addEventListener('click', (e) => {
    const missing = pending.filter((it) => !normalizeSku(it.sku));
    if (missing.length) { toast(`${missing.length} photo(s) have no SKU`, true); return; }
    const tags = $('#bulk-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    const bar = $('#up-progress');
    bar.hidden = false;
    busy(e.currentTarget, 'Uploading…', async () => {
      try {
        const n = pending.length;
        await uploadPhotos(pending.map((it) => ({ ...it, tags })), user, (x) => {
          bar.firstElementChild.style.width = `${Math.round(x * 100)}%`;
          $('#up-status').textContent = `${Math.round(x * 100)}%`;
        });
        pending = [];
        toast(`${n} photo${n > 1 ? 's' : ''} uploaded`);
        rerender();
      } catch (err) { toast(`Upload failed: ${err.message}`, true); bar.hidden = true; $('#up-status').textContent = ''; }
    });
  });

  draw();
  return {
    isDirty: () => pending.length > 0,
    destroy: () => { io.disconnect(); if (lb.open) lb.close(); },
  };
}

export { syncPhotoAccess };
