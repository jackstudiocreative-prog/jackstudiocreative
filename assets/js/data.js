// Shared data helpers — used by the public site and the Studio.
//
// Repository layout
//   data/index.json            one entry per project (title, status, cover…) — rebuilt on every save
//   data/projects/<id>.json    a project: { id, type, title, …, draft: {...}, published: {...} | null }
//   data/library.json          product library: { products: [{ id, name, series, price, description, image }] }
//   media/…                    photos, panoramas, 3D models
//
// Project types
//   product   draft = { productId, spin: { folder, pattern, count, pad, reverse? } | null, model: { glb, usdz?, poster? } | null,
//                       action?: { folder, pattern, count, pad, frame, x, y, span, label?, closeLabel? } }
//             action = optional "open / close" photo sequence played from a hotspot on the spin (see spin-viewer.js):
//             frame = spin frame (1-based) it starts from, x/y = hotspot position on the photo (0–1), span = frames either side it shows on
//   showroom  draft = { startScene, scenes: [{ id, name, panorama, thumb, view: { yaw, pitch }, hotspots: [...] }] }
//   hotspots: { type: 'scene', target, label } | { type: 'product', project, label } | { type: 'info', title, text }, each with yaw/pitch

// Site root, worked out from this file's location (assets/js/ → ../../), so it works from any page.
export const ROOT = new URL('../../', import.meta.url).href;
export const siteURL = (path) => new URL(path, ROOT).href;

const cache = new Map();
export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(siteURL(path), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `Cannot load ${path} (${r.status})`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export const getIndex = () => loadJSON('data/index.json').catch(() => ({ projects: [] }));
export const getProject = (id) => loadJSON(`data/projects/${encodeURIComponent(id)}.json`);
export const getLibrary = () => loadJSON('data/library.json').catch(() => ({ products: [] }));
export async function getLibraryProduct(id) {
  const lib = await getLibrary();
  return lib.products.find((p) => p.id === id) || null;
}

/** ?preview=1 shows the draft (used by the Studio's Preview button). */
export const isPreview = () => new URLSearchParams(location.search).get('preview') === '1';
export const versionOf = (project, preview = isPreview()) => (preview ? project.draft : project.published) || null;

export function spinFrames(spin) {
  if (!spin) return [];
  const { folder, pattern, count, pad = 0 } = spin;
  return Array.from({ length: count }, (_, i) => siteURL(`${folder}/${pattern.replace('{n}', String(i + 1).padStart(pad, '0'))}`));
}

/** A product's open / close sequence in the shape SpinViewer takes, or null. `frames` maps the stored photos to URLs. */
export function spinAction(action, frames = spinFrames) {
  if (!action || !action.folder || !(action.count >= 2)) return null;
  const { frame, x, y, span, label, closeLabel } = action;
  return { frames: frames(action), frame, x, y, span, label, closeLabel };
}

export function coverOf(type, data) {
  if (!data) return '';
  if (type === 'product') return data.spin ? `${data.spin.folder}/${data.spin.pattern.replace('{n}', String(1).padStart(data.spin.pad || 0, '0'))}` : data.model?.poster || '';
  const start = data.scenes?.find((s) => s.id === data.startScene) || data.scenes?.[0];
  return start ? start.thumb || start.panorama : '';
}

/** 'draft' (never published) | 'published' | 'changed' (published, with newer edits) */
export function statusOf(project) {
  if (!project.published) return 'draft';
  return JSON.stringify(project.draft) === JSON.stringify(project.published) ? 'published' : 'changed';
}

/** The summary stored for a project in data/index.json. */
export function indexEntry(p) {
  const pub = p.published;
  return {
    id: p.id, type: p.type, title: p.title, status: statusOf(p),
    createdBy: p.createdBy, updatedBy: p.updatedBy, updatedAt: p.updatedAt, publishedAt: p.publishedAt || null,
    cover: coverOf(p.type, p.draft),
    productId: p.type === 'product' ? p.draft?.productId || null : undefined,
    sceneCount: p.type === 'showroom' ? p.draft?.scenes?.length || 0 : undefined,
    published: pub ? {
      cover: coverOf(p.type, pub),
      productId: p.type === 'product' ? pub.productId : undefined,
      sceneCount: p.type === 'showroom' ? pub.scenes?.length || 0 : undefined,
      hasModel: p.type === 'product' ? Boolean(pub.model) : undefined,
    } : null,
  };
}

// ?embed=1 hides the header so a page can sit inside an iframe (e.g. Shopify)
export function applyEmbedMode() {
  if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('is-embed');
}

export function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
