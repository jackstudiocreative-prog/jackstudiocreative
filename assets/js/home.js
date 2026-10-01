// Home — lists showroom scenes and products from the JSON data
import { loadJSON, getProducts, spinFrames, escapeHTML } from './data.js';

async function init() {
  const [showroom, products] = await Promise.all([loadJSON('data/showroom.json'), getProducts()]);

  document.getElementById('scene-grid').innerHTML = showroom.scenes.map((s) => `
    <a class="card" href="showroom.html?scene=${encodeURIComponent(s.id)}">
      <img src="${s.thumb || s.panorama}" alt="" loading="lazy" style="aspect-ratio:2/1">
      <div class="card-body"><h3>${escapeHTML(s.name)}</h3>
      <div class="card-meta">${(s.hotspots || []).length} hotspots</div></div>
    </a>`).join('');

  document.getElementById('product-grid').innerHTML = products.map((p) => `
    <a class="card" href="product.html?id=${encodeURIComponent(p.id)}">
      <img src="${p.cover || spinFrames(p.spin)[0] || p.model?.poster || ''}" alt="" loading="lazy">
      <div class="card-body"><h3>${escapeHTML(p.name)}</h3>
      <div class="card-meta">${escapeHTML(p.series || '')}${p.model?.glb ? ' · 3D / AR' : ''}</div></div>
    </a>`).join('');
}

init().catch((err) => console.error(err));
