// Home — published showrooms and products
import { getIndex, getLibrary, siteURL, escapeHTML } from './data.js';

async function init() {
  const [index, lib] = await Promise.all([getIndex(), getLibrary()]);
  const live = index.projects.filter((p) => p.published);
  const showrooms = live.filter((p) => p.type === 'showroom');
  const products = live.filter((p) => p.type === 'product');
  const productName = (id) => lib.products.find((x) => x.id === id);

  document.getElementById('scene-grid').innerHTML = showrooms.map((s) => `
    <a class="card" href="showroom.html?id=${encodeURIComponent(s.id)}">
      ${s.published.cover ? `<img src="${siteURL(s.published.cover)}" alt="" loading="lazy" style="aspect-ratio:2/1">` : ''}
      <div class="card-body"><h3>${escapeHTML(s.title)}</h3>
      <div class="card-meta">${s.published.sceneCount} ${s.published.sceneCount === 1 ? 'area' : 'areas'}</div></div>
    </a>`).join('') || '<p class="card-meta">Coming soon.</p>';

  document.getElementById('product-grid').innerHTML = products.map((p) => {
    const info = productName(p.published.productId);
    return `
    <a class="card" href="product.html?id=${encodeURIComponent(p.id)}">
      ${p.published.cover ? `<img src="${siteURL(p.published.cover)}" alt="" loading="lazy">` : ''}
      <div class="card-body"><h3>${escapeHTML(info?.name || p.title)}</h3>
      <div class="card-meta">${escapeHTML(info?.series || '')}${p.published.hasModel ? ' · 3D / AR' : ''}</div></div>
    </a>`;
  }).join('') || '<p class="card-meta">Coming soon.</p>';

  const first = showrooms[0];
  document.querySelectorAll('[data-first-showroom]').forEach((a) => {
    if (first) a.href = `showroom.html?id=${encodeURIComponent(first.id)}`;
  });
}

init().catch((err) => console.error(err));
