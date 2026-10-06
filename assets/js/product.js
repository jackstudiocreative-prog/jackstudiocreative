// Product 360° page — a published product project: image-sequence spin and/or 3D model (GLB) with AR
import { SpinViewer } from './spin-viewer.js';
import { getIndex, getProject, getLibraryProduct, versionOf, isPreview, spinFrames, spinAction, siteURL, applyEmbedMode, escapeHTML } from './data.js';

const MODEL_VIEWER_SRC = new URL('../vendor/model-viewer/model-viewer.min.js', import.meta.url).href;

applyEmbedMode();

const stage = document.getElementById('viewer-stage');
const tabs = document.getElementById('viewer-tabs');
const info = document.getElementById('product-info');

let spin = null;

function showSpin(p) {
  spin?.destroy();
  stage.innerHTML = '';
  spin = new SpinViewer(stage, spinFrames(p.spin), { label: `${p.name} 360° view`, reverse: p.spin.reverse, action: spinAction(p.action) });
}

async function showModel(p) {
  spin?.destroy(); // stops a running open / close animation
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
  mv.setAttribute('src', siteURL(p.model.glb));
  if (p.model.usdz) mv.setAttribute('ios-src', siteURL(p.model.usdz));
  if (p.model.poster) mv.setAttribute('poster', siteURL(p.model.poster));
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
    ${p.description ? `<p>${escapeHTML(p.description)}</p>` : ''}`;
}

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  let project = null;
  try { project = id ? await getProject(id) : null; } catch {}
  const data = project && versionOf(project);
  if (!data) {
    stage.innerHTML = `<p class="error-msg">${project ? 'This product is not published yet.' : 'Product not found.'}</p>`;
    return;
  }
  if (isPreview()) document.body.classList.add('is-preview');
  const lib = data.productId ? await getLibraryProduct(data.productId) : null;
  const p = { name: lib?.name || project.title, series: lib?.series, price: lib?.price, description: lib?.description, spin: data.spin, model: data.model, action: data.action };
  renderInfo(p);
  const first = renderTabs(p);
  if (first === 'spin') showSpin(p);
  else if (first === 'model') showModel(p);
  else stage.innerHTML = '<p class="error-msg">No 360° media for this product yet.</p>';
}

getIndex().then((index) => {
  const first = index.projects.find((x) => x.type === 'showroom' && x.published);
  if (first) document.querySelectorAll('[data-first-showroom]').forEach((a) => { a.href = `showroom.html?id=${encodeURIComponent(first.id)}`; });
});

init().catch((err) => {
  console.error(err);
  stage.innerHTML = `<p class="error-msg">${escapeHTML(err.message)}</p>`;
});
