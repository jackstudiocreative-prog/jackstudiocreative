// Product 360° page — image-sequence spin and/or 3D model (GLB) with AR
import { SpinViewer } from './spin-viewer.js';
import { getProduct, spinFrames, applyEmbedMode, escapeHTML } from './data.js';

const MODEL_VIEWER_SRC = new URL('../vendor/model-viewer/model-viewer.min.js', import.meta.url).href;

applyEmbedMode();

const stage = document.getElementById('viewer-stage');
const tabs = document.getElementById('viewer-tabs');
const info = document.getElementById('product-info');

let spin = null;

function showSpin(p) {
  stage.innerHTML = '';
  spin = new SpinViewer(stage, spinFrames(p.spin), { label: `${p.name} 360° view`, reverse: p.spin.reverse });
}

async function showModel(p) {
  stage.innerHTML = '';
  spin = null;
  if (!customElements.get('model-viewer')) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = MODEL_VIEWER_SRC;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load 3D viewer'));
      document.head.append(s);
    });
  }
  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', p.model.glb);
  if (p.model.usdz) mv.setAttribute('ios-src', p.model.usdz);
  if (p.model.poster) mv.setAttribute('poster', p.model.poster);
  mv.setAttribute('alt', `${p.name} 3D model`);
  const attrs = { 'camera-controls': '', ar: '', 'shadow-intensity': '0.6', 'touch-action': 'pan-y' };
  Object.entries(attrs).forEach(([k, v]) => mv.setAttribute(k, v));
  stage.append(mv);
}

function renderTabs(p) {
  const modes = [];
  if (p.spin) modes.push({ id: 'spin', label: '360° Photo' });
  if (p.model?.glb) modes.push({ id: 'model', label: '3D / AR' });
  tabs.hidden = modes.length < 2;
  tabs.innerHTML = modes.map((m, i) =>
    `<button type="button" role="tab" data-mode="${m.id}" aria-selected="${i === 0}">${m.label}</button>`).join('');

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn || btn.getAttribute('aria-selected') === 'true') return;
    tabs.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', b === btn));
    btn.dataset.mode === 'model' ? showModel(p) : showSpin(p);
  });
  return modes[0]?.id;
}

function renderInfo(p) {
  document.title = `${p.name} — Jack Studio 360°`;
  const desc = p.description || `View the ${p.name} by Jack Studio in 360°.`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
  info.innerHTML = `
    <div class="eyebrow">${escapeHTML(p.series || '')}</div>
    <h1>${escapeHTML(p.name)}</h1>
    ${p.price ? `<div class="price">${escapeHTML(p.price)}</div>` : ''}
    ${p.description ? `<p>${escapeHTML(p.description)}</p>` : ''}
    ${p.shopUrl ? `<a class="btn" href="${p.shopUrl}" target="_top" rel="noopener">Shop now</a>` : ''}`;
}

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const p = id && (await getProduct(id));
  if (!p) {
    stage.innerHTML = `<p class="error-msg">Product not found. Check the <code>?id=</code> in the URL and data/products.json.</p>`;
    return;
  }
  renderInfo(p);
  const first = renderTabs(p);
  if (first === 'spin') showSpin(p);
  else if (first === 'model') showModel(p);
  else stage.innerHTML = '<p class="error-msg">No 360° media for this product yet.</p>';
}

init().catch((err) => {
  console.error(err);
  stage.innerHTML = `<p class="error-msg">${escapeHTML(err.message)}</p>`;
});
