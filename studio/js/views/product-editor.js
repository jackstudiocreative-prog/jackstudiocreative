// Product 360° editor: multi-angle photos or turntable video → spin; optional open / close sequence with a hotspot;
// optional 3D model; linked library product
import { loadLibrary, libraryUpdate, mediaURL } from '../store.js';
import { photosToFrames, videoToFrames, isVideo } from '../media-tools.js';
import { SpinViewer } from '../../../assets/js/spin-viewer.js';
import { spinAction } from '../../../assets/js/data.js';
import { SERIES, SITE_BASE } from '../config.js';
import qrcode from '../../../assets/vendor/qrcode/qrcode.mjs';
import { esc, toast, slugify, uniqueId } from '../ui.js';

const MODEL_VIEWER = new URL('../../../assets/vendor/model-viewer/model-viewer.min.js', import.meta.url).href;

const framesOf = (spin) => (spin ? Array.from({ length: spin.count }, (_, i) =>
  mediaURL(`${spin.folder}/${spin.pattern.replace('{n}', String(i + 1).padStart(spin.pad || 0, '0'))}`)) : []);

// Open / close action: where it starts, where its hotspot sits and what it says (see spin-viewer.js)
const ACTION_DEFAULTS = { frame: 1, x: 0.5, y: 0.5, span: 2, label: '', closeLabel: '' };
const SPANS = [[0, 'Only at this exact angle'], [1, 'Within 1 photo of this angle'], [2, 'Within 2 photos of this angle'], [3, 'Within 3 photos of this angle'], [99, 'At every angle']];

export function mountProductEditor(el, { project: p, onChange }) {
  const d = p.draft;
  const pending = { frames: null, frameUrls: [], action: null, actionUrls: [], glb: null, usdz: null, modelUrl: null, newProduct: null };
  let viewer = null, mode = 'spin', busy = false, videoFile = null, library = { products: [] };
  let actionVideo = null, placing = false, lastIndex = 0;
  const act = { ...ACTION_DEFAULTS };
  if (d.action) Object.keys(ACTION_DEFAULTS).forEach((k) => { if (d.action[k] != null) act[k] = d.action[k]; });

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
          <p class="hint phone-line"><button class="link-btn" type="button" data-phone="spin">Shoot with a phone instead</button></p>
          <div class="phone-box" data-phone-box="spin" hidden></div>
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

        <section class="panel">
          <h2>Open / close <span class="sub-inline">optional</span></h2>
          <p class="sub">Show how the product opens — a zip, a flap, a lid. Keep the camera and the product still, open it a little at a time and take a photo at each step (8–30 photos, ordered by file name). A video of it opening works too. Customers press a hotspot on the product to play it.</p>
          <label class="drop" id="a-drop">
            <strong>Drop the opening photos or a video here, or click to choose</strong>
            <span>First photo closed · last photo fully open</span>
            <input type="file" id="a-input" accept="image/*,video/*" multiple hidden>
          </label>
          <p class="hint phone-line"><button class="link-btn" type="button" data-phone="action">Shoot with a phone instead</button></p>
          <div class="phone-box" data-phone-box="action" hidden></div>
          <div id="a-video-opts" hidden style="margin-top:14px">
            <div class="row">
              <div class="field">
                <label for="a-count">Photos to extract</label>
                <select class="select" id="a-count">
                  <option value="12">12 (lighter)</option><option value="20" selected>20 (recommended)</option><option value="30">30 (smoothest)</option>
                </select>
              </div>
              <div class="field">
                <label>Opening (seconds)</label>
                <div class="inline">
                  <input class="input" id="a-start" type="number" min="0" step="0.1" value="0" style="width:90px" aria-label="Start second">
                  <span>to</span>
                  <input class="input" id="a-end" type="number" min="0" step="0.1" style="width:90px" aria-label="End second">
                </div>
                <span class="hint" id="a-duration"></span>
              </div>
            </div>
            <button class="btn btn--sm" type="button" id="a-extract">Create from video</button>
          </div>
          <div class="progress" id="a-progress" hidden><i></i></div>
          <div class="status" id="a-status" aria-live="polite"></div>
          <div class="strip" id="a-strip"></div>
          <div id="a-settings" hidden>
            <div class="field" style="margin-top:14px">
              <span class="label">Angle and hotspot</span>
              <div class="inline">
                <button class="btn btn--ghost btn--sm" type="button" id="a-angle">Use the angle shown above</button>
                <button class="btn btn--sm" type="button" id="a-place">Place hotspot</button>
              </div>
              <span class="hint" id="a-where"></span>
              <span class="hint">Turn the preview to the angle the opening photos were taken from, press “Use the angle shown above”, then place the hotspot on the part that opens.</span>
            </div>
            <div class="row">
              <div class="field"><label for="a-label">Hotspot label</label><input class="input" id="a-label" maxlength="24" placeholder="Open" value="${esc(act.label)}"></div>
              <div class="field"><label for="a-close">Label when open</label><input class="input" id="a-close" maxlength="24" placeholder="Close" value="${esc(act.closeLabel)}"></div>
            </div>
            <div class="field">
              <label for="a-span">Show the hotspot</label>
              <select class="select" id="a-span">${SPANS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            </div>
            <button class="btn btn--danger btn--sm" type="button" id="a-remove">Remove open / close</button>
          </div>
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
  const bar = (sel) => (v) => {
    $(sel).hidden = v == null;
    if (v != null) $(sel).firstElementChild.style.width = `${Math.round(v * 100)}%`;
  };
  const progress = bar('#progress');
  const actionProgress = bar('#a-progress');
  const actionStatus = (t) => { $('#a-status').textContent = t; };

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
  const currentActionFrames = () => (pending.actionUrls.length ? pending.actionUrls : spinAction(d.action, framesOf)?.frames || []);
  const actionCfg = () => ({
    frame: act.frame, x: act.x, y: act.y, span: act.span,
    ...(act.label ? { label: act.label } : {}), ...(act.closeLabel ? { closeLabel: act.closeLabel } : {}),
  });
  const previewAction = () => {
    const frames = currentActionFrames();
    return frames.length >= 2 ? { frames, ...actionCfg() } : null;
  };
  function showPreview() {
    stopPlacing();
    if (viewer instanceof SpinViewer) lastIndex = viewer.index;
    viewer?.destroy?.();
    viewer = null;
    stage.innerHTML = '';
    if (mode === 'spin') {
      const frames = currentFrames();
      if (!frames.length) { stage.innerHTML = '<div class="ph">Add photos or a video to see the 360° preview</div>'; return; }
      viewer = new SpinViewer(stage, frames, { reverse: $('#reverse').checked, label: p.title, action: previewAction(), startIndex: lastIndex });
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

  /* ---- open / close action ---- */
  /** Writes the settings into the draft (once the photos are saved there) and refreshes the panel and preview. */
  function applyAction({ preview = true } = {}) {
    if (d.action) {
      const { folder, pattern, count, pad } = d.action;
      d.action = { folder, pattern, count, pad, ...actionCfg() };
    }
    renderAction();
    if (preview) showPreview();
    onChange();
  }
  function renderAction() {
    const frames = currentActionFrames();
    const has = frames.length >= 2;
    $('#a-settings').hidden = !has;
    const step = Math.max(1, Math.floor(frames.length / 24));
    $('#a-strip').innerHTML = frames.filter((_, i) => i % step === 0).map((src) => `<img src="${esc(src)}" alt="">`).join('');
    if (!has) return;
    const total = currentFrames().length;
    $('#a-where').textContent = `Opens from photo ${total ? `${Math.min(act.frame, total)} of ${total}` : act.frame} · hotspot ${Math.round(act.x * 100)}% across, ${Math.round(act.y * 100)}% down`;
    $('#a-span').value = String(SPANS.some(([v]) => v === act.span) ? act.span : 2);
  }
  function setPendingAction(blobs) {
    const first = !currentActionFrames().length;
    pending.actionUrls.forEach(URL.revokeObjectURL);
    pending.action = blobs;
    pending.actionUrls = blobs.map((b) => URL.createObjectURL(b));
    // a new sequence starts from the angle the preview is showing, until the editor says otherwise
    if (first && viewer instanceof SpinViewer && mode === 'spin') act.frame = viewer.index + 1;
    if (mode !== 'spin') mode = 'spin';
    $('#tabs').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === mode));
    actionStatus(`${blobs.length} opening photos ready · press Save draft to upload`);
    applyAction();
  }
  async function handleActionFiles(files) {
    if (busy || !files.length) return;
    const video = [...files].find(isVideo);
    if (video) {
      actionVideo = video;
      $('#a-video-opts').hidden = false;
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = URL.createObjectURL(video);
      probe.onloadedmetadata = () => {
        $('#a-end').value = probe.duration.toFixed(1);
        $('#a-duration').textContent = `Video length ${probe.duration.toFixed(1)} s`;
        URL.revokeObjectURL(probe.src);
      };
      actionStatus(`Video selected: ${video.name}. Set where the opening starts and ends, then press "Create from video".`);
      return;
    }
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (images.length < 3) { toast('Use at least 3 photos to show the product opening', true); return; }
    busy = true;
    actionStatus(`Processing ${images.length} photos…`);
    try { setPendingAction(await photosToFrames(images, { onProgress: actionProgress })); }
    catch (err) { toast(err.message, true); actionStatus(''); }
    finally { busy = false; actionProgress(null); }
  }
  const actionDrop = $('#a-drop');
  $('#a-input').addEventListener('change', (e) => { handleActionFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => actionDrop.addEventListener(t, (e) => { e.preventDefault(); actionDrop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => actionDrop.addEventListener(t, (e) => { e.preventDefault(); actionDrop.classList.remove('is-over'); }));
  actionDrop.addEventListener('drop', (e) => handleActionFiles(e.dataTransfer.files));
  $('#a-extract').addEventListener('click', async () => {
    if (!actionVideo || busy) return;
    busy = true;
    const count = Number($('#a-count').value);
    actionStatus(`Extracting ${count} photos…`);
    try {
      setPendingAction(await videoToFrames(actionVideo, {
        count, inclusive: true, start: Number($('#a-start').value) || 0, end: Number($('#a-end').value) || null, onProgress: actionProgress,
      }));
    } catch (err) { toast(err.message, true); actionStatus(''); }
    finally { busy = false; actionProgress(null); }
  });

  $('#a-angle').addEventListener('click', () => {
    if (!(viewer instanceof SpinViewer)) { toast('Open the 360° Photos preview first', true); return; }
    if (viewer.opened || viewer.playing) { toast('Close the product in the preview first', true); return; }
    act.frame = viewer.index + 1;
    applyAction();
  });
  $('#a-span').addEventListener('change', () => { act.span = Number($('#a-span').value); applyAction(); });
  [['#a-label', 'label'], ['#a-close', 'closeLabel']].forEach(([sel, key]) => $(sel).addEventListener('input', () => {
    act[key] = $(sel).value.trim();
    if (viewer?.action) { // update the preview hotspot in place, without restarting the preview on every key
      viewer.action.label = act.label || 'Open';
      viewer.action.closeLabel = act.closeLabel || 'Close';
      viewer.updateHotspot();
    }
    applyAction({ preview: false });
  }));

  // Placing the hotspot: the preview turns to the opening angle and the next click on the photo sets the position
  function stopPlacing() {
    if (!placing) return;
    placing = false;
    stage.classList.remove('is-placing');
    viewer?.lock?.(false);
    $('#a-place').textContent = 'Place hotspot';
    actionStatus('');
  }
  $('#a-place').addEventListener('click', () => {
    if (placing) { stopPlacing(); return; }
    if (!currentFrames().length) { toast('Add the 360° photos first', true); return; }
    mode = 'spin';
    $('#tabs').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === mode));
    showPreview();
    viewer.show(act.frame - 1);
    viewer.lock(true);
    placing = true;
    stage.classList.add('is-placing');
    $('#a-place').textContent = 'Cancel';
    actionStatus('Click on the product in the preview, on the part that opens');
    stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  stage.addEventListener('click', (e) => {
    if (!placing || !(viewer instanceof SpinViewer)) return;
    const pt = viewer.pointToImage(e.clientX, e.clientY);
    if (!pt) { toast('Click on the photo itself', true); return; }
    act.x = pt.x;
    act.y = pt.y;
    stopPlacing();
    applyAction();
  });
  const onKey = (e) => { if (e.key === 'Escape' && placing) stopPlacing(); };
  document.addEventListener('keydown', onKey);

  $('#a-remove').addEventListener('click', () => {
    if (!confirm('Remove the open / close photos and hotspot from this project?')) return;
    delete d.action;
    pending.actionUrls.forEach(URL.revokeObjectURL);
    pending.action = null;
    pending.actionUrls = [];
    actionVideo = null;
    $('#a-video-opts').hidden = true;
    Object.assign(act, ACTION_DEFAULTS);
    $('#a-label').value = '';
    $('#a-close').value = '';
    actionStatus('Removed — press Save draft');
    applyAction();
  });

  /* ---- shoot with a phone: a QR code that opens the guided capture page for this project ---- */
  el.querySelectorAll('[data-phone]').forEach((btn) => btn.addEventListener('click', () => {
    const kind = btn.dataset.phone;
    const box = el.querySelector(`[data-phone-box="${kind}"]`);
    box.hidden = !box.hidden;
    if (box.hidden || box.childElementCount) return;
    const url = `${SITE_BASE}/capture/product.html?project=${encodeURIComponent(p.id)}&shoot=${kind}`;
    const text = document.createElement('div');
    text.innerHTML = `<b>Scan this with the phone’s camera</b>
      <span>It opens the camera with live guides: a frame, a ghost of the last photo and a level. ${kind === 'spin'
        ? 'Shoot one full turn'
        : 'Shoot the product opening, step by step'}, then save to this project.</span>
      <span>The phone must be signed in to the Studio. Save your changes here first, and reload this page after saving on the phone.</span>
      <a href="${esc(url)}" target="_blank" rel="noopener">Open on this device ↗</a>`;
    box.append(qrCanvas(url), text);
  }));

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
  renderAction();

  return {
    hasPending: () => Boolean(pending.frames || pending.action || pending.glb || pending.usdz || pending.newProduct),
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
        const product = { id, name, series: $('#np-series').value.trim(), price: '', description: $('#np-desc').value.trim(), image: '', updatedAt: new Date().toISOString() };
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
      if (pending.action || d.action) {
        if (!d.spin) throw new Error('Add the 360° photos before the open / close photos');
        act.frame = Math.min(Math.max(1, act.frame), d.spin.count); // the 360° photos may have been replaced by a shorter set
      }
      if (pending.action) {
        const pad = Math.max(2, String(pending.action.length).length);
        const folder = `media/products/${p.id}/action-${ts}`;
        pending.action.forEach((b, i) => put.push({ path: `${folder}/frame-${String(i + 1).padStart(pad, '0')}.jpg`, content: b }));
        d.action = { folder, pattern: 'frame-{n}.jpg', count: pending.action.length, pad, ...actionCfg() };
      } else if (d.action) {
        const { folder, pattern, count, pad } = d.action;
        d.action = { folder, pattern, count, pad, ...actionCfg() };
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
      pending.frames = pending.action = pending.glb = pending.usdz = null;
      status('');
      actionStatus('');
      renderAction();
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
      viewer?.destroy?.();
      pending.frameUrls.forEach(URL.revokeObjectURL);
      pending.actionUrls.forEach(URL.revokeObjectURL);
      if (pending.modelUrl) URL.revokeObjectURL(pending.modelUrl);
    },
  };
}

/** QR code in brand colours (dark espresso on white keeps it scannable). */
function qrCanvas(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount(), cell = 6, quiet = 4, size = (n + quiet * 2) * cell;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#401410';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', `QR code for ${url}`);
  return cv;
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
