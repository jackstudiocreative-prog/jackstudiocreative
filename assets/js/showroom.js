// Showroom 360° — a published showroom project (data/projects/<id>.json)
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { getIndex, getProject, getLibraryProduct, versionOf, isPreview, coverOf, siteURL, applyEmbedMode, escapeHTML } from './data.js';

applyEmbedMode();

const els = {
  pano: document.getElementById('pano'),
  title: document.getElementById('scene-title'),
  list: document.getElementById('scene-list'),
  drawer: document.getElementById('drawer'),
  drawerBody: document.getElementById('drawer-body'),
  drawerClose: document.getElementById('drawer-close'),
};

const ICONS = { scene: '→', product: '+', info: 'i' };
const deg = (v) => `${v}deg`;

const productNames = new Map(); // product project id → product name (default hotspot label)

function markerHTML(h) {
  const label = h.label || h.title || (h.type === 'product' ? productNames.get(h.project) : '') || '';
  return `<div class="hs hs--${h.type}">
    <span class="hs-dot" aria-hidden="true">${ICONS[h.type] || '+'}</span>
    ${label ? `<span class="hs-label">${escapeHTML(label)}</span>` : ''}
  </div>`;
}

function toMarkers(scene) {
  return (scene.hotspots || []).map((h, i) => ({
    id: `${scene.id}-${i}`,
    position: { yaw: deg(h.yaw), pitch: deg(h.pitch) },
    html: markerHTML(h),
    anchor: 'center left',
    data: h,
  }));
}

async function loadShowroom(params) {
  let id = params.get('id');
  if (!id) {
    const index = await getIndex();
    id = index.projects.find((p) => p.type === 'showroom' && p.published)?.id;
    if (!id) throw new Error('No showroom has been published yet.');
  }
  const project = await getProject(id).catch(() => { throw new Error('This showroom does not exist.'); });
  const data = versionOf(project);
  if (!data || !data.scenes?.length) throw new Error(isPreview() ? 'This showroom has no scenes yet.' : 'This showroom is not published yet.');
  // default labels for product hotspots
  const ids = new Set(data.scenes.flatMap((s) => s.hotspots.filter((h) => h.type === 'product').map((h) => h.project)));
  await Promise.all([...ids].map(async (pid) => {
    try {
      const pr = await getProject(pid);
      const v = versionOf(pr) || pr.draft;
      const info = v?.productId ? await getLibraryProduct(v.productId) : null;
      productNames.set(pid, info?.name || pr.title);
    } catch {}
  }));
  return { id, title: project.title, startScene: data.startScene, scenes: data.scenes };
}

async function init() {
  const params = new URLSearchParams(location.search);
  const config = await loadShowroom(params);
  if (isPreview()) document.body.classList.add('is-preview');
  document.title = `${config.title} — Jack Studio 360°`;
  const scenes = Object.fromEntries(config.scenes.map((s) => [s.id, s]));
  let current = scenes[params.get('scene')] || scenes[config.startScene] || config.scenes[0];

  const viewer = new Viewer({
    container: els.pano,
    panorama: siteURL(current.panorama),
    defaultYaw: deg(current.view?.yaw ?? 0),
    defaultPitch: deg(current.view?.pitch ?? 0),
    navbar: ['zoom', 'move', 'caption', 'fullscreen'],
    caption: config.title,
    mousewheelCtrlKey: document.body.classList.contains('is-embed'), // don't hijack page scroll when embedded
    touchmoveTwoFingers: document.body.classList.contains('is-embed'),
    plugins: [MarkersPlugin],
  });
  const markers = viewer.getPlugin(MarkersPlugin);

  function renderSceneList() {
    els.list.innerHTML = config.scenes.map((s) => `
      <li><button type="button" data-scene="${s.id}" aria-current="${s.id === current.id}">
        ${s.thumb ? `<img src="${siteURL(s.thumb)}" alt="" loading="lazy">` : ''}
        <span>${escapeHTML(s.name)}</span>
      </button></li>`).join('');
    els.list.hidden = config.scenes.length < 2;
  }

  function setSceneUI() {
    els.title.textContent = current.name;
    renderSceneList();
    const url = new URL(location.href);
    url.searchParams.set('id', config.id);
    url.searchParams.set('scene', current.id);
    history.replaceState(null, '', url);
  }

  async function goTo(id) {
    const next = scenes[id];
    if (!next || next.id === current.id) return;
    current = next;
    closeDrawer();
    markers.clearMarkers();
    setSceneUI();
    await viewer.setPanorama(siteURL(next.panorama), {
      position: { yaw: deg(next.view?.yaw ?? 0), pitch: deg(next.view?.pitch ?? 0) },
      transition: { speed: 1200, effect: 'fade', rotation: false },
    });
    markers.setMarkers(toMarkers(next));
  }

  viewer.addEventListener('ready', () => markers.setMarkers(toMarkers(current)), { once: true });

  markers.addEventListener('select-marker', ({ marker }) => {
    const h = marker.data;
    if (h.type === 'scene') goTo(h.target);
    else if (h.type === 'product') openProduct(h.project);
    else if (h.type === 'info') openInfo(h);
  });

  els.list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scene]');
    if (btn) goTo(btn.dataset.scene);
  });

  // ?edit=1 — click anywhere to get hotspot coordinates (copied to clipboard)
  if (params.get('edit') === '1') {
    viewer.addEventListener('click', ({ data }) => {
      if (data.rightclick) return;
      const toDeg = (r) => Math.round((r * 180) / Math.PI);
      const yaw = toDeg(data.yaw) > 180 ? toDeg(data.yaw) - 360 : toDeg(data.yaw);
      const snippet = `"yaw": ${yaw}, "pitch": ${toDeg(data.pitch)}`;
      navigator.clipboard?.writeText(snippet).catch(() => {});
      els.title.textContent = `${current.name} · ${snippet}`;
    });
  }

  setSceneUI();
}

/* Drawer */
let lastFocus = null;

function openDrawer(html) {
  lastFocus = document.activeElement;
  els.drawerBody.innerHTML = html;
  els.drawer.classList.add('is-open');
  els.drawer.setAttribute('aria-hidden', 'false');
  els.drawer.inert = false;
  els.drawerClose.focus();
}

function closeDrawer() {
  if (!els.drawer.classList.contains('is-open')) return;
  els.drawer.classList.remove('is-open');
  els.drawer.setAttribute('aria-hidden', 'true');
  els.drawer.inert = true;
  lastFocus?.focus?.();
}

async function openProduct(id) {
  let project;
  try { project = await getProject(id); } catch { return openDrawer('<p>This product is not available.</p>'); }
  const data = versionOf(project);
  if (!data) return openDrawer('<p>This product is not published yet.</p>');
  const info = data.productId ? await getLibraryProduct(data.productId) : null;
  const cover = info?.image ? siteURL(info.image) : coverOf('product', data) ? siteURL(coverOf('product', data)) : '';
  const name = info?.name || project.title;
  const keep = ['embed', 'preview'].filter((k) => new URLSearchParams(location.search).get(k) === '1').map((k) => `&${k}=1`).join('');
  openDrawer(`
    ${cover ? `<img src="${cover}" alt="${escapeHTML(name)}">` : ''}
    <div class="eyebrow">${escapeHTML(info?.series || '')}</div>
    <h2 id="drawer-title">${escapeHTML(name)}</h2>
    ${info?.price ? `<div class="price">${escapeHTML(info.price)}</div>` : ''}
    ${info?.description ? `<p>${escapeHTML(info.description)}</p>` : ''}
    <div class="drawer-actions">
      <a class="btn" href="product.html?id=${encodeURIComponent(project.id)}${keep}">View in 360°</a>
    </div>`);
}

function openInfo(h) {
  openDrawer(`
    <h2 id="drawer-title">${escapeHTML(h.title || '')}</h2>
    <p>${escapeHTML(h.text || '')}</p>`);
}

els.drawerClose.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

init().catch((err) => {
  console.error(err);
  els.pano.innerHTML = `<p class="error-msg">${escapeHTML(err.message)}</p>`;
});
