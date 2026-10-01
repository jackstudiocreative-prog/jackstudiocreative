// Showroom 360° — Photo Sphere Viewer + markers, scenes and hotspots from data/showroom.json
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { loadJSON, getProduct, spinFrames, applyEmbedMode, escapeHTML } from './data.js';

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

function markerHTML(h) {
  const label = h.label || h.title || '';
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

async function init() {
  const config = await loadJSON('data/showroom.json');
  const scenes = Object.fromEntries(config.scenes.map((s) => [s.id, s]));
  const params = new URLSearchParams(location.search);
  let current = scenes[params.get('scene')] || scenes[config.startScene] || config.scenes[0];

  const viewer = new Viewer({
    container: els.pano,
    panorama: current.panorama,
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
        ${s.thumb ? `<img src="${s.thumb}" alt="" loading="lazy">` : ''}
        <span>${escapeHTML(s.name)}</span>
      </button></li>`).join('');
    els.list.hidden = config.scenes.length < 2;
  }

  function setSceneUI() {
    els.title.textContent = current.name;
    renderSceneList();
    const url = new URL(location.href);
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
    await viewer.setPanorama(next.panorama, {
      position: { yaw: deg(next.view?.yaw ?? 0), pitch: deg(next.view?.pitch ?? 0) },
      transition: { speed: 1200, effect: 'fade', rotation: false },
    });
    markers.setMarkers(toMarkers(next));
  }

  viewer.addEventListener('ready', () => markers.setMarkers(toMarkers(current)), { once: true });

  markers.addEventListener('select-marker', ({ marker }) => {
    const h = marker.data;
    if (h.type === 'scene') goTo(h.target);
    else if (h.type === 'product') openProduct(h.product);
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
  const p = await getProduct(id);
  if (!p) return openDrawer(`<p>Product "${escapeHTML(id)}" not found in data/products.json.</p>`);
  const cover = p.cover || spinFrames(p.spin)[0] || '';
  const embed = document.body.classList.contains('is-embed') ? '&embed=1' : '';
  openDrawer(`
    ${cover ? `<img src="${cover}" alt="${escapeHTML(p.name)}">` : ''}
    <div class="eyebrow">${escapeHTML(p.series || '')}</div>
    <h2 id="drawer-title">${escapeHTML(p.name)}</h2>
    ${p.price ? `<div class="price">${escapeHTML(p.price)}</div>` : ''}
    ${p.description ? `<p>${escapeHTML(p.description)}</p>` : ''}
    <div class="drawer-actions">
      <a class="btn" href="product.html?id=${encodeURIComponent(p.id)}${embed}">View in 360°</a>
      ${p.shopUrl ? `<a class="btn btn--ghost" href="${p.shopUrl}" target="_top" rel="noopener">Shop now</a>` : ''}
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
