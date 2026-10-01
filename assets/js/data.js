// Shared data helpers
const cache = {};

export async function loadJSON(path) {
  if (!cache[path]) {
    cache[path] = fetch(path).then((r) => {
      if (!r.ok) throw new Error(`Cannot load ${path} (${r.status})`);
      return r.json();
    });
  }
  return cache[path];
}

export async function getProducts() {
  const data = await loadJSON('data/products.json');
  return data.products;
}

export async function getProduct(id) {
  const products = await getProducts();
  return products.find((p) => p.id === id) || null;
}

// Build the list of frame URLs for a product's 360° spin
export function spinFrames(spin) {
  if (!spin) return [];
  const { folder, pattern, count, pad = 0 } = spin;
  return Array.from({ length: count }, (_, i) =>
    `${folder}/${pattern.replace('{n}', String(i + 1).padStart(pad, '0'))}`
  );
}

// ?embed=1 hides the header so the page can sit inside an iframe (e.g. Shopify)
export function applyEmbedMode() {
  if (new URLSearchParams(location.search).get('embed') === '1') {
    document.body.classList.add('is-embed');
  }
}

export function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
