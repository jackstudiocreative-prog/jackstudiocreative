// Product 360° editor: multi-angle photos or turntable video → spin; optional 3D model; linked library product
import { loadLibrary, libraryUpdate, mediaURL } from '../store.js';
import { photosToFrames, videoToFrames, isVideo } from '../media-tools.js';
import { SpinViewer } from '../../../assets/js/spin-viewer.js';
import { SERIES } from '../config.js';
import { esc, toast, slugify, uniqueId } from '../ui.js';

const MODEL_VIEWER = new URL('../../../assets/vendor/model-viewer/model-viewer.min.js', import.meta.url).href;

const framesOf = (spin) => (spin ? Array.from({ length: spin.count }, (_, i) =>
  mediaURL(`${spin.folder}/${spin.pattern.replace('{n}', String(i + 1).padStart(spin.pad || 0, '0'))}`)) : []);

export function mountProductEditor(el, { project: p, onChange }) {
  const d = p.draft;
  const pending = { frames: null, frameUrls: [], glb: null, usdz: null, modelUrl: null, newProduct: null };
  let viewer = null, mode = 'spin', busy = false, videoFile = null, library = { products: [] };

  el.innerHTML = `
    <div class="editor">
      <div>
        <div class="viewer-tabs" id="tabs" role="tablist">
          <button type="button" role="tab" data-mode="spin" aria-selected="true">360° Photos</button>
          <button type="button" role="tab" data-mode="model" aria-selected="false">3D / AR</button>
        </div>
        <div class="preview-stage" id="stage"></div>

        <section class="panel" style="margin-top:16px">
          <h2>Multi-angle photos</h2>
          <p class="sub">Upload turntable photos (24–72, ordered by file name) or a video of one full turn. They are resized on this computer before uploading.</p>
          <label class="drop" id="drop">
            <strong>Drop photos or a video here, or click to choose</strong>
            <span>JPG · PNG · WebP · MP4 · MOV</span>
            <input type="file" id="frames-input" accept="image/*,video/*" multiple hidden>
          </label>
          <div id="video-opts" hidden style="margin-top:14px">
            <div class="row">
              <div class="field">
                <label for="v-count">Frames to extract</label>
                <select class="select" id="v-count">
                  <option value="24">24 (lighter)</option><option value="36" selected>36 (recommended)</option>
                  <option value="48">48</option><option value="72">72 (smoothest)</option>
                </select>
              </div>
              <div class="field">
                <label>One full turn (seconds)</label>
                <div class="inline">
                  <input class="input" id="v-start" type="number" min="0" step="0.1" value="0" style="width:90px" aria-label="Start second">
                  <span>to</span>
                  <input class="input" id="v-end" type="number" min="0" step="0.1" style="width:90px" aria-label="End second">
                </div>
                <span class="hint" id="v-duration"></span>
              </div>
            </div>
            <button class="btn btn--sm" type="button" id="extract">Create 360° from video</button>
          </div>
          <div class="progress" id="progress" hidden><i></i></div>
          <div class="status" id="status" aria-live="polite"></div>
          <div class="strip" id="strip"></div>
          <label class="check" style="margin-top:12px"><input type="checkbox" id="reverse" ${d.spin?.reverse ? 'checked' : ''}> Reverse rotation direction</label>
        </section>
      </div>

      <div>
        <section class="panel">
          <h2>Product</h2>
          <p class="sub">The name, series and description shown with the 360° view come from the <a href="#/library">Product Library</a>.</p>
          <div class="field">
            <label for="product">Library product</label>
            <select class="select" id="product"><option value="">Loading…</option></select>
          </div>
          <div id="new-product" hidden>
            <div class="row">
              <div class="field"><label for="np-name">New product name</label><input class="input" id="np-name" maxlength="100"></div>
              <div class="field"><label for="np-series">Series</label><input class="input" id="np-series" list="series-list">
                <datalist id="series-list">${SERIES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
            </div>
            <div class="field"><label for="np-desc">Description</label><textarea class="textarea" id="np-desc"></textarea></div>
          </div>
          <div id="product-card"></div>
        </section>

        <section class="panel">
          <h2>3D model <span class="sub-inline">optional</span></h2>
          <p class="sub">Export from Blender as glTF Binary (.glb). Add a .usdz for AR on iPhone.</p>
          <div class="field"><label for="f-glb">.glb file</label><input class="input" id="f-glb" type="file" accept=".glb,model/gltf-binary">
            <span class="hint" id="glb-status">${d.model ? 'A 3D model is attached' : 'None yet'}</span></div>
          <div class="field"><label for="f-usdz">.usdz file (iPhone AR)</label><input class="input" id="f-usdz" type="file" accept=".usdz"></div>
          ${d.model ? '<button class="btn btn--danger btn--sm" type="button" id="remove-model">Remove 3D model</button>' : ''}
        </section>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const stage = $('#stage');
  const status = (t) => { $('#status').textContent = t; };
  const progress = (v) => {
    $('#progress').hidden = v == null;
    if (v != null) $('#progress').firstElementChild.style.width = `${Math.round(v * 100)}%`;
  };

  /* ---- product (library) ---- */
  function renderProductSelect() {
    const opts = library.products.map((x) => `<option value="${esc(x.id)}" ${x.id === d.productId ? 'selected' : ''}>${esc(x.name)}${x.series ? ` — ${esc(x.series)}` : ''}</option>`).join('');
    $('#product').innerHTML = `<option value="">Choose a product…</option>${opts}<option value="__new">+ New product…</option>`;
    if (pending.newProduct) $('#product').value = '__new';
    renderProductCard();
  }
  function renderProductCard() {
    const x = library.products.find((y) => y.id === d.productId);
    $('#new-product').hidden = $('#product').value !== '__new';
    $('#product-card').innerHTML = x && $('#product').value !== '__new' ? `
      <div class="mini-card">
        ${x.image ? `<img src="${esc(mediaURL(x.image))}" alt="">` : ''}
        <div><b>${esc(x.name)}</b><span>${esc(x.series || '')}</span><a href="#/library/${encodeURIComponent(x.id)}">Edit in library</a></div>
      </div>` : '';
  }
  loadLibrary().then((lib) => { library = lib; renderProductSelect(); }).catch((e) => toast(e.message, true));
  $('#product').addEventListener('change', () => {
    if ($('#product').value === '__new') { pending.newProduct = {}; $('#np-name').focus(); }
    else { pending.newProduct = null; d.productId = $('#product').value || null; }
    renderProductCard();
    onChange();
  });
  ['#np-name', '#np-series', '#np-desc'].forEach((s) => $(s).addEventListener('input', onChange));

  /* ---- preview ---- */
  const currentFrames = () => (pending.frameUrls.length ? pending.frameUrls : framesOf(d.spin));
  function showPreview() {
    viewer?.destroy?.();
    viewer = null;
    stage.innerHTML = '';
    if (mode === 'spin') {
      const frames = currentFrames();
      if (!frames.length) { stage.innerHTML = '<div class="ph">Add photos or a video to see the 360° preview</div>'; return; }
      viewer = new SpinViewer(stage, frames, { reverse: $('#reverse').checked, label: p.title });
    } else {
      const src = pending.modelUrl || (d.model?.glb ? mediaURL(d.model.glb) : '');
      if (!src) { stage.innerHTML = '<div class="ph">Upload a .glb file to see the 3D preview</div>'; return; }
      loadModelViewer().then(() => {
        if (mode === 'model') stage.innerHTML = `<model-viewer src="${esc(src)}" camera-controls shadow-intensity="0.6" alt="3D preview"></model-viewer>`;
      }).catch((e) => toast(e.message, true));
    }
  }
  function renderStrip() {
    const frames = currentFrames();
    const step = Math.max(1, Math.floor(frames.length / 24));
    $('#strip').innerHTML = frames.filter((_, i) => i % step === 0).map((src) => `<img src="${esc(src)}" alt="">`).join('');
  }
  const selectTab = (m) => {
    mode = m;
    $('#tabs').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === m));
    showPreview();
  };
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) selectTab(b.dataset.mode); });

  /* ---- photos / video ---- */
  function setPendingFrames(blobs) {
    pending.frameUrls.forEach(URL.revokeObjectURL);
    pending.frames = blobs;
    pending.frameUrls = blobs.map((b) => URL.createObjectURL(b));
    selectTab('spin');
    renderStrip();
    status(`${blobs.length} frames ready · press Save draft to upload`);
    onChange();
  }
  async function handleFiles(files) {
    if (busy || !files.length) return;
    const video = [...files].find(isVideo);
    if (video) {
      videoFile = video;
      $('#video-opts').hidden = false;
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = URL.createObjectURL(video);
      probe.onloadedmetadata = () => {
        $('#v-end').value = probe.duration.toFixed(1);
        $('#v-duration').textContent = `Video length ${probe.duration.toFixed(1)} s`;
        URL.revokeObjectURL(probe.src);
      };
      status(`Video selected: ${video.name}. Set the turn, then press "Create 360° from video".`);
      return;
    }
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (images.length < 8) { toast('Use at least 8 photos for a 360° view', true); return; }
    busy = true;
    status(`Processing ${images.length} photos…`);
    try { setPendingFrames(await photosToFrames(images, { onProgress: progress })); }
    catch (err) { toast(err.message, true); status(''); }
    finally { busy = false; progress(null); }
  }
  const drop = $('#drop');
  $('#frames-input').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  $('#extract').addEventListener('click', async () => {
    if (!videoFile || busy) return;
    busy = true;
    const count = Number($('#v-count').value);
    status(`Extracting ${count} frames…`);
    try {
      setPendingFrames(await videoToFrames(videoFile, { count, start: Number($('#v-start').value) || 0, end: Number($('#v-end').value) || null, onProgress: progress }));
    } catch (err) { toast(err.message, true); status(''); }
    finally { busy = false; progress(null); }
  });
  $('#reverse').addEventListener('change', () => {
    if (d.spin) { if ($('#reverse').checked) d.spin.reverse = true; else delete d.spin.reverse; }
    showPreview();
    onChange();
  });

  /* ---- 3D model ---- */
  $('#f-glb').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (pending.modelUrl) URL.revokeObjectURL(pending.modelUrl);
    pending.glb = f;
    pending.modelUrl = URL.createObjectURL(f);
    $('#glb-status').textContent = `${f.name} · press Save draft to upload`;
    selectTab('model');
    onChange();
  });
  $('#f-usdz').addEventListener('change', (e) => { pending.usdz = e.target.files[0] || null; onChange(); });
  $('#remove-model')?.addEventListener('click', () => {
    if (!confirm('Remove the 3D model from this project?')) return;
    d.model = null;
    pending.glb = pending.usdz = null;
    pending.modelUrl = null;
    $('#remove-model').remove();
    $('#glb-status').textContent = 'Removed — press Save draft';
    showPreview();
    onChange();
  });

  showPreview();
  renderStrip();

  return {
    hasPending: () => Boolean(pending.frames || pending.glb || pending.usdz || pending.newProduct),
    progress,
    ready() {
      if (!d.spin && !d.model) { toast('Add photos, a video or a 3D model before publishing', true); return false; }
      if (!d.productId && !pending.newProduct) { toast('Choose the library product before publishing', true); return false; }
      return true;
    },
    async collect() {
      const put = [], extraUpdates = [];
      const ts = Date.now().toString(36);
      if (pending.newProduct) {
        const name = $('#np-name').value.trim();
        if (!name) throw new Error('Enter the new product name, or choose an existing product');
        const id = uniqueId(slugify(name) || 'product', new Set(library.products.map((x) => x.id)));
        const product = { id, name, series: $('#np-series').value.trim(), price: '', description: $('#np-desc').value.trim(), image: '' };
        pending.newProduct = product;
        extraUpdates.push(libraryUpdate(product));
        d.productId = id;
      }
      if (pending.frames) {
        status('Uploading photos…');
        const pad = String(pending.frames.length).length < 2 ? 2 : String(pending.frames.length).length;
        const folder = `media/products/${p.id}/spin-${ts}`;
        pending.frames.forEach((b, i) => put.push({ path: `${folder}/frame-${String(i + 1).padStart(pad, '0')}.jpg`, content: b }));
        d.spin = { folder, pattern: 'frame-{n}.jpg', count: pending.frames.length, pad, ...($('#reverse').checked ? { reverse: true } : {}) };
      }
      if (pending.glb) {
        const glb = `media/products/${p.id}/model-${ts}.glb`;
        put.push({ path: glb, content: pending.glb });
        d.model = { glb };
        if (pending.usdz) { const usdz = `media/products/${p.id}/model-${ts}.usdz`; put.push({ path: usdz, content: pending.usdz }); d.model.usdz = usdz; }
        if (d.spin) d.model.poster = `${d.spin.folder}/${d.spin.pattern.replace('{n}', '1'.padStart(d.spin.pad || 0, '0'))}`;
      } else if (pending.usdz && d.model) {
        const usdz = `media/products/${p.id}/model-${ts}.usdz`;
        put.push({ path: usdz, content: pending.usdz });
        d.model.usdz = usdz;
      }
      return { put, extraUpdates };
    },
    saved() {
      if (pending.newProduct) { library.products.push(pending.newProduct); pending.newProduct = null; renderProductSelect(); }
      pending.frames = pending.glb = pending.usdz = null;
      status('');
    },
    destroy() {
      viewer?.destroy?.();
      pending.frameUrls.forEach(URL.revokeObjectURL);
      if (pending.modelUrl) URL.revokeObjectURL(pending.modelUrl);
    },
  };
}

function loadModelViewer() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = MODEL_VIEWER;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the 3D viewer'));
    document.head.append(s);
  });
}
