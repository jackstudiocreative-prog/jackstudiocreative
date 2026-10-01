// Showroom editor: scenes from uploads, the Asset Library or phone captures; click to place hotspots
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { loadIndex, listAssets, mediaURL } from '../store.js';
import { preparePanorama } from '../media-tools.js';
import { esc, toast, slugify, uniqueId } from '../ui.js';

const ICONS = { scene: '→', product: '+', info: 'i' };
const TYPE_NAMES = { scene: 'Link to another scene', product: 'Product', info: 'Info' };
const toDeg = (rad) => {
  let d = Math.round((rad * 180) / Math.PI);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

export function mountShowroomEditor(el, { project: p, onChange }) {
  const d = p.draft;
  const pending = new Map(); // sceneId → { file, thumb, url, thumbUrl }
  let products = [];         // product projects for product hotspots
  let sceneId = d.startScene || d.scenes[0]?.id || null;
  let selected = -1, placing = null, viewer = null, markers = null, busy = false;

  const scene = () => d.scenes.find((s) => s.id === sceneId);
  const panoSrc = (s) => pending.get(s.id)?.url || mediaURL(s.panorama);
  const thumbSrc = (s) => pending.get(s.id)?.thumbUrl || mediaURL(s.thumb || s.panorama);
  const productName = (id) => products.find((x) => x.id === id)?.title;
  const sceneName = (id) => d.scenes.find((s) => s.id === id)?.name;
  const hsName = (x) => (x.type === 'info' ? x.title : x.label || (x.type === 'scene' ? sceneName(x.target) : productName(x.project))) || '(not set)';

  el.innerHTML = `
    <div class="sr">
      <aside>
        <ul class="scene-items" id="scenes"></ul>
        <div class="add-scene">
          <label class="btn btn--ghost btn--sm">+ Upload panorama
            <input type="file" id="add-scene" accept="image/jpeg,image/png,image/webp" hidden></label>
          <button class="btn btn--ghost btn--sm" type="button" id="from-assets">+ From Asset Library</button>
          <a class="btn btn--ghost btn--sm" href="../capture/" target="_blank" rel="noopener">Capture with phone ↗</a>
        </div>
        <p class="status" style="margin-top:10px">Panoramas must be 2:1 (e.g. 6000×3000) — from a 360° camera or the phone capture tool.</p>
        <div class="picker" id="picker" hidden></div>
      </aside>

      <section>
        <div class="sr-toolbar" id="toolbar">
          <button class="btn btn--sm" type="button" data-place="scene">→ Add scene link</button>
          <button class="btn btn--sm" type="button" data-place="product">+ Add product</button>
          <button class="btn btn--sm" type="button" data-place="info">i Add info</button>
          <button class="btn btn--ghost btn--sm" type="button" id="set-view">Use current view as start</button>
        </div>
        <div class="sr-stage" id="stage">
          <div class="sr-banner" id="banner" hidden><span id="banner-text"></span><button type="button" id="cancel-place">Cancel</button></div>
          <div id="pano" style="position:absolute;inset:0"></div>
        </div>
        <p class="status" id="status" aria-live="polite"></p>
      </section>

      <aside class="sr-side" id="side"></aside>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const status = (t) => { $('#status').textContent = t; };
  const changed = () => { renderScenes(); onChange(); };

  /* ---------- scenes ---------- */
  function renderScenes() {
    $('#scenes').innerHTML = d.scenes.map((s) => `
      <li><button type="button" data-scene="${esc(s.id)}" aria-current="${s.id === sceneId}">
        <img src="${esc(thumbSrc(s))}" alt="">
        <span><b>${esc(s.name)}</b><small>${s.id === d.startScene ? 'Start · ' : ''}${s.hotspots.length} hotspots</small></span>
      </button></li>`).join('') || '<li class="status">No scenes yet</li>';
    $('#toolbar').querySelectorAll('button').forEach((b) => { b.disabled = !d.scenes.length; });
  }
  $('#scenes').addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (b) selectScene(b.dataset.scene); });

  /* ---------- viewer ---------- */
  function markerConfig(h, i) {
    const label = h.type === 'info' ? h.title : h.label || (h.type === 'scene' ? sceneName(h.target) : productName(h.project)) || '';
    return {
      id: `hs-${i}`,
      position: { yaw: `${h.yaw}deg`, pitch: `${h.pitch}deg` },
      html: `<div class="hs hs--${h.type}${i === selected ? ' is-selected' : ''}"><span class="hs-dot" aria-hidden="true">${ICONS[h.type]}</span>${label ? `<span class="hs-label">${esc(label)}</span>` : ''}</div>`,
      anchor: 'center left',
      data: { index: i },
    };
  }
  const refreshMarkers = () => markers?.setMarkers(scene() ? scene().hotspots.map(markerConfig) : []);

  function ensureViewer() {
    if (viewer || !scene()) return;
    const s = scene();
    $('#pano').innerHTML = '';
    viewer = new Viewer({
      container: $('#pano'), panorama: panoSrc(s),
      defaultYaw: `${s.view?.yaw || 0}deg`, defaultPitch: `${s.view?.pitch || 0}deg`,
      navbar: ['zoom', 'move', 'fullscreen'], plugins: [MarkersPlugin],
    });
    markers = viewer.getPlugin(MarkersPlugin);
    viewer.addEventListener('ready', refreshMarkers, { once: true });
    viewer.addEventListener('click', ({ data }) => {
      if (!placing || data.rightclick) return;
      const s2 = scene();
      const pos = { yaw: toDeg(data.yaw), pitch: toDeg(data.pitch) };
      if (placing.move != null) { Object.assign(s2.hotspots[placing.move], pos); selected = placing.move; }
      else {
        const h = { type: placing.type, ...pos };
        if (h.type === 'scene') { h.target = d.scenes.find((x) => x.id !== s2.id)?.id || ''; h.label = ''; }
        if (h.type === 'product') { h.project = products[0]?.id || ''; h.label = ''; }
        if (h.type === 'info') { h.title = 'Title'; h.text = ''; }
        s2.hotspots.push(h);
        selected = s2.hotspots.length - 1;
      }
      stopPlacing(); refreshMarkers(); renderSide(); changed();
    });
    markers.addEventListener('select-marker', ({ marker }) => {
      if (placing) return;
      selected = marker.data.index;
      refreshMarkers(); renderSide();
    });
  }

  async function selectScene(id) {
    sceneId = id; selected = -1;
    stopPlacing(); renderScenes(); renderSide();
    const s = scene();
    if (!s) return;
    if (!viewer) return ensureViewer();
    markers.clearMarkers();
    await viewer.setPanorama(panoSrc(s), { position: { yaw: `${s.view?.yaw || 0}deg`, pitch: `${s.view?.pitch || 0}deg` }, transition: false });
    refreshMarkers();
  }

  /* ---------- placing ---------- */
  function startPlacing(pl) {
    placing = pl;
    $('#stage').classList.add('is-placing');
    $('#banner').hidden = false;
    $('#banner-text').textContent = pl.move != null ? 'Click the new position on the panorama' : `Click where the "${TYPE_NAMES[pl.type]}" hotspot goes`;
  }
  function stopPlacing() { placing = null; $('#stage').classList.remove('is-placing'); $('#banner').hidden = true; }
  $('#toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]');
    if (!b) return;
    if (b.dataset.place === 'scene' && d.scenes.length < 2) { toast('Add a second scene first, then link them', true); return; }
    if (b.dataset.place === 'product' && !products.length) { toast('Create a Product 360° project first', true); return; }
    startPlacing({ type: b.dataset.place });
  });
  $('#cancel-place').addEventListener('click', stopPlacing);
  const onKey = (e) => { if (e.key === 'Escape' && placing) stopPlacing(); };
  document.addEventListener('keydown', onKey);
  $('#set-view').addEventListener('click', () => {
    if (!viewer || !scene()) return;
    const { yaw, pitch } = viewer.getPosition();
    scene().view = { yaw: toDeg(yaw), pitch: toDeg(pitch) };
    toast('Start view set');
    onChange();
  });

  /* ---------- side panel ---------- */
  function renderSide() {
    const s = scene();
    const side = $('#side');
    if (!s) { side.innerHTML = ''; return; }
    const h = s.hotspots[selected];
    let form = '';
    if (h) {
      const sceneOpts = d.scenes.filter((x) => x.id !== s.id).map((x) => `<option value="${esc(x.id)}" ${x.id === h.target ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
      const prodOpts = products.map((x) => `<option value="${esc(x.id)}" ${x.id === h.project ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
      form = `
        <section class="panel">
          <h2>${TYPE_NAMES[h.type]}</h2>
          <p class="sub">Position: yaw ${h.yaw}° · pitch ${h.pitch}°</p>
          ${h.type === 'scene' ? `
            <div class="field"><label for="h-target">Goes to</label><select class="select" id="h-target" data-k="target">${sceneOpts}</select></div>
            <div class="field"><label for="h-label">Label (optional)</label><input class="input" id="h-label" data-k="label" value="${esc(h.label)}" placeholder="Uses the scene name"></div>` : ''}
          ${h.type === 'product' ? `
            <div class="field"><label for="h-project">Product 360° project</label><select class="select" id="h-project" data-k="project">${prodOpts}</select></div>
            <div class="field"><label for="h-label">Label (optional)</label><input class="input" id="h-label" data-k="label" value="${esc(h.label)}" placeholder="Uses the product name"></div>` : ''}
          ${h.type === 'info' ? `
            <div class="field"><label for="h-title">Title</label><input class="input" id="h-title" data-k="title" value="${esc(h.title)}"></div>
            <div class="field"><label for="h-text">Text</label><textarea class="textarea" id="h-text" data-k="text">${esc(h.text)}</textarea></div>` : ''}
          <div class="inline">
            <button class="btn btn--ghost btn--sm" type="button" id="h-move">Move</button>
            <button class="btn btn--danger btn--sm" type="button" id="h-delete">Delete</button>
          </div>
        </section>`;
    }
    side.innerHTML = `
      ${form}
      <section class="panel">
        <h2>Hotspots</h2>
        <p class="sub">${s.hotspots.length ? 'Select a hotspot to edit it' : 'Use the buttons above, then click on the panorama'}</p>
        <ul class="hs-list">${s.hotspots.map((x, i) => `<li><button type="button" data-hs="${i}" aria-current="${i === selected}"><span class="t t--${x.type}">${ICONS[x.type]}</span><span class="hs-name">${esc(hsName(x))}</span></button></li>`).join('')}</ul>
      </section>
      <section class="panel">
        <h2>Scene</h2>
        <div class="field"><label for="s-name">Scene name</label><input class="input" id="s-name" value="${esc(s.name)}"></div>
        <label class="check" style="margin-bottom:14px"><input type="checkbox" id="s-start" ${d.startScene === s.id ? 'checked disabled' : ''}> Start the tour here</label>
        <div class="inline">
          <label class="btn btn--ghost btn--sm">Replace panorama<input type="file" id="s-replace" accept="image/jpeg,image/png,image/webp" hidden></label>
          <button class="btn btn--danger btn--sm" type="button" id="s-delete">Delete scene</button>
        </div>
      </section>`;

    side.querySelector('.hs-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hs]');
      if (!b) return;
      selected = Number(b.dataset.hs);
      refreshMarkers(); renderSide();
      const t = s.hotspots[selected];
      viewer?.animate({ yaw: `${t.yaw}deg`, pitch: `${t.pitch}deg`, speed: '6rpm' });
    });
    side.querySelectorAll('[data-k]').forEach((input) => input.addEventListener('input', () => {
      s.hotspots[selected][input.dataset.k] = input.value;
      refreshMarkers();
      const row = side.querySelector(`[data-hs="${selected}"] .hs-name`);
      if (row) row.textContent = hsName(s.hotspots[selected]);
      onChange();
    }));
    side.querySelector('#h-move')?.addEventListener('click', () => startPlacing({ move: selected }));
    side.querySelector('#h-delete')?.addEventListener('click', () => {
      s.hotspots.splice(selected, 1);
      selected = -1;
      refreshMarkers(); renderSide(); changed();
    });
    side.querySelector('#s-name').addEventListener('input', (e) => { s.name = e.target.value; changed(); });
    side.querySelector('#s-start').addEventListener('change', () => { d.startScene = s.id; renderSide(); changed(); });
    side.querySelector('#s-replace').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) addPanorama(f, s); });
    side.querySelector('#s-delete').addEventListener('click', () => {
      const links = d.scenes.reduce((n, x) => n + x.hotspots.filter((hh) => hh.type === 'scene' && hh.target === s.id).length, 0);
      if (!confirm(`Delete scene "${s.name}"?${links ? ` ${links} link(s) to it from other scenes are removed too.` : ''}`)) return;
      d.scenes = d.scenes.filter((x) => x.id !== s.id);
      d.scenes.forEach((x) => { x.hotspots = x.hotspots.filter((hh) => !(hh.type === 'scene' && hh.target === s.id)); });
      pending.delete(s.id);
      if (d.startScene === s.id) d.startScene = d.scenes[0]?.id || '';
      onChange();
      if (d.scenes.length) selectScene(d.scenes[0].id);
      else { viewer?.destroy(); viewer = null; markers = null; sceneId = null; renderScenes(); renderSide(); showEmpty(); }
    });
  }

  /* ---------- adding panoramas ---------- */
  function newScene(name) {
    const id = uniqueId(slugify(name) || 'scene', new Set(d.scenes.map((x) => x.id)));
    const s = { id, name: name.slice(0, 60) || 'New scene', panorama: '', view: { yaw: 0, pitch: 0 }, hotspots: [] };
    d.scenes.push(s);
    if (!d.startScene) d.startScene = s.id;
    return s;
  }

  async function addPanorama(file, existing = null) {
    if (busy) return;
    busy = true;
    status('Preparing panorama…');
    try {
      const prep = await preparePanorama(file);
      if (prep.warning && !confirm(`${prep.warning}\n\nUse this image anyway?`)) { status(''); return; }
      const s = existing || newScene(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      const old = pending.get(s.id);
      if (old) { URL.revokeObjectURL(old.url); URL.revokeObjectURL(old.thumbUrl); }
      pending.set(s.id, { file: prep.file, thumb: prep.thumb, url: URL.createObjectURL(prep.file), thumbUrl: URL.createObjectURL(prep.thumb) });
      status(`${prep.width}×${prep.height} · press Save draft to upload`);
      onChange();
      if (s.id === sceneId && viewer) { await viewer.setPanorama(panoSrc(s), { transition: false }); refreshMarkers(); renderScenes(); }
      else await selectScene(s.id);
    } catch (err) { toast(err.message, true); status(''); }
    finally { busy = false; }
  }
  $('#add-scene').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addPanorama(f); });

  $('#from-assets').addEventListener('click', async () => {
    const picker = $('#picker');
    if (!picker.hidden) { picker.hidden = true; return; }
    picker.hidden = false;
    picker.innerHTML = '<p class="status">Loading assets…</p>';
    try {
      const files = await listAssets();
      const panos = files.filter((f) => f.path.startsWith('media/assets/') && /\.(jpe?g|png|webp)$/i.test(f.path) && !/\.thumb\.jpg$/.test(f.path));
      const thumbOf = (path) => { const t = path.replace(/\.(jpe?g|png|webp)$/i, '.thumb.jpg'); return files.some((f) => f.path === t) ? t : path; };
      picker.innerHTML = panos.length
        ? `<p class="status">Choose a panorama</p><ul class="pick-grid">${panos.map((f) => `<li><button type="button" data-path="${esc(f.path)}"><img src="${esc(mediaURL(thumbOf(f.path)))}" alt=""><span>${esc(f.path.split('/').pop())}</span></button></li>`).join('')}</ul>`
        : '<p class="status">No panoramas in the Asset Library yet. Use "Capture with phone" or upload one under Assets.</p>';
      picker.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', () => {
        const path = b.dataset.path;
        const s = newScene(path.split('/').pop().replace(/\.[^.]+$/, '').replace(/^pano-/, 'Scene ').replace(/[-_]+/g, ' '));
        s.panorama = path;
        const t = thumbOf(path);
        if (t !== path) s.thumb = t;
        picker.hidden = true;
        onChange();
        selectScene(s.id);
      }));
    } catch (err) { picker.innerHTML = `<p class="status">${esc(err.message)}</p>`; }
  });

  function showEmpty() {
    $('#pano').innerHTML = '<div class="empty" style="margin:24px;background:var(--ivory)">Add the first scene: upload a panorama, pick one from the Asset Library, or capture one with a phone.</div>';
  }

  loadIndex().then((idx) => { products = idx.projects.filter((x) => x.type === 'product'); renderSide(); refreshMarkers(); }).catch(() => {});
  renderScenes();
  renderSide();
  if (scene()) ensureViewer(); else showEmpty();

  return {
    hasPending: () => pending.size > 0,
    ready() {
      if (!d.scenes.length) { toast('Add at least one scene before publishing', true); return false; }
      if (d.scenes.some((s) => !s.panorama && !pending.has(s.id))) { toast('Every scene needs a panorama', true); return false; }
      return true;
    },
    async collect() {
      const put = [];
      const ts = Date.now().toString(36);
      for (const [id, pdata] of pending) {
        const s = d.scenes.find((x) => x.id === id);
        if (!s) continue;
        s.panorama = `media/scenes/${p.id}/${id}-${ts}.jpg`;
        s.thumb = `media/scenes/${p.id}/${id}-${ts}.thumb.jpg`;
        put.push({ path: s.panorama, content: pdata.file }, { path: s.thumb, content: pdata.thumb });
      }
      return { put };
    },
    saved() { pending.clear(); status(''); renderScenes(); },
    destroy() {
      document.removeEventListener('keydown', onKey);
      viewer?.destroy();
      pending.forEach((x) => { URL.revokeObjectURL(x.url); URL.revokeObjectURL(x.thumbUrl); });
    },
  };
}
