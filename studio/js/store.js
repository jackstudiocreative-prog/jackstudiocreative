// Studio data operations. Every change is one atomic GitHub commit.
import { readJSON, commit, listFiles } from './github.js';
import { indexEntry, statusOf, siteURL } from '../../assets/js/data.js';
import { SITE_BASE } from './config.js';

const PROJECT = (id) => `data/projects/${id}.json`;
const INDEX = 'data/index.json';
const LIBRARY = 'data/library.json';
const json = (o) => JSON.stringify(o, null, 2) + '\n';
const now = () => new Date().toISOString();

/* ---------- media shown before GitHub Pages has published it ---------- */
const localMedia = new Map(); // repo path → blob URL (files uploaded in this browser session)
export const mediaURL = (path) => (path ? localMedia.get(path) || siteURL(path) : '');
export function rememberLocal(path, blob) { localMedia.set(path, URL.createObjectURL(blob)); }

/* ---------- reading ---------- */
export async function loadIndex() {
  const { data } = await readJSON(INDEX);
  return data || { projects: [] };
}
export async function loadProject(id) {
  const { data, sha } = await readJSON(PROJECT(id));
  if (!data) throw new Error('This project no longer exists.');
  return { project: data, sha };
}
export async function loadAllProjects() {
  const index = await loadIndex();
  const out = await Promise.all(index.projects.map((p) => loadProject(p.id).then((r) => r.project).catch(() => null)));
  return out.filter(Boolean);
}
export async function loadLibrary() {
  const { data } = await readJSON(LIBRARY);
  return data || { products: [] };
}

/* ---------- media ownership & clean-up ---------- */
const ownFolders = (p) => [`media/products/${p.id}/`, `media/scenes/${p.id}/`];

function referenced(p) {
  const refs = new Set();
  for (const v of [p.draft, p.published]) {
    if (!v) continue;
    if (p.type === 'product') {
      if (v.spin) refs.add(`${v.spin.folder}/`);
      if (v.model) Object.values(v.model).forEach((x) => x && refs.add(x));
    } else {
      (v.scenes || []).forEach((s) => { refs.add(s.panorama); if (s.thumb) refs.add(s.thumb); });
    }
  }
  return refs;
}
const isReferenced = (path, refs) => refs.has(path) || [...refs].some((r) => r.endsWith('/') && path.startsWith(r));

/** Project-owned media no version of the project uses any more. */
async function unusedMedia(p, extraKeep = []) {
  const refs = referenced(p);
  extraKeep.forEach((x) => refs.add(x));
  const files = await listFiles('media/');
  return files.map((f) => f.path).filter((path) => ownFolders(p).some((f) => path.startsWith(f)) && !isReferenced(path, refs));
}

/* ---------- index & sitemap (rebuilt from the latest version on every commit) ---------- */
const indexUpdate = (p, removed = false) => ({
  path: INDEX,
  fn: (text) => {
    const idx = text ? JSON.parse(text) : { projects: [] };
    idx.projects = idx.projects.filter((x) => x.id !== p.id);
    if (!removed) idx.projects.push(indexEntry(p));
    idx.projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    idx.updatedAt = now();
    return json(idx);
  },
});

function sitemapFromIndex(indexText) {
  const idx = indexText ? JSON.parse(indexText) : { projects: [] };
  const day = now().slice(0, 10);
  const urls = [`${SITE_BASE}/`, ...idx.projects.filter((x) => x.published)
    .map((x) => `${SITE_BASE}/${x.type === 'showroom' ? 'showroom' : 'product'}.html?id=${encodeURIComponent(x.id)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc><lastmod>${day}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

/** Index update + sitemap rebuilt from that same new index, inside one commit. */
function indexAndSitemap(p, removed = false) {
  let idxText = null;
  const iu = indexUpdate(p, removed);
  return [
    { path: INDEX, fn: (text) => (idxText = iu.fn(text)) },
    { path: 'sitemap.xml', fn: () => sitemapFromIndex(idxText) },
  ];
}

/* ---------- projects ---------- */
export function newProject(type, title, user, id) {
  const t = now();
  return {
    id, type, title,
    createdBy: user.login, createdAt: t, updatedBy: user.login, updatedAt: t,
    publishedBy: null, publishedAt: null,
    draft: type === 'product' ? { productId: null, spin: null, model: null } : { startScene: '', scenes: [] },
    published: null,
  };
}

/**
 * Saves a project (and any new media) in one commit.
 *  sha: the version that was loaded (null for a brand-new project) — protects against overwriting a colleague
 *  put: new media files [{ path, content }]
 *  extra: { update: [...] } extra read-modify-write files (e.g. the library for a quick-added product)
 */
export async function saveProject(p, user, { sha = null, put = [], message, extraUpdates = [], onProgress } = {}) {
  p.updatedBy = user.login;
  p.updatedAt = now();
  const keepNew = put.map((f) => f.path);
  const remove = sha ? await unusedMedia(p, keepNew) : [];
  const res = await commit({
    message: message || `Update ${p.type} "${p.title}"`,
    put: [...put, { path: PROJECT(p.id), content: json(p) }],
    update: [indexUpdate(p), ...extraUpdates],
    remove,
    expect: { [PROJECT(p.id)]: sha },
    onProgress,
  });
  put.forEach((f) => typeof f.content !== 'string' && rememberLocal(f.path, f.content));
  return { ...res, sha: await currentSha(p.id) };
}

async function currentSha(id) {
  try { return (await readJSON(PROJECT(id))).sha; } catch { return null; }
}

export async function publishProject(p, user, sha) {
  p.published = structuredClone(p.draft);
  p.publishedBy = user.login;
  p.publishedAt = now();
  p.updatedBy = user.login;
  p.updatedAt = p.publishedAt;
  await commit({
    message: `Publish ${p.type} "${p.title}"`,
    put: [{ path: PROJECT(p.id), content: json(p) }],
    update: indexAndSitemap(p),
    remove: await unusedMedia(p),
    expect: { [PROJECT(p.id)]: sha },
  });
  return currentSha(p.id);
}

export async function unpublishProject(p, user, sha) {
  p.published = null;
  p.publishedAt = null;
  p.publishedBy = null;
  p.updatedBy = user.login;
  p.updatedAt = now();
  await commit({
    message: `Unpublish ${p.type} "${p.title}"`,
    put: [{ path: PROJECT(p.id), content: json(p) }],
    update: indexAndSitemap(p),
    remove: await unusedMedia(p),
    expect: { [PROJECT(p.id)]: sha },
  });
  return currentSha(p.id);
}

export async function deleteProject(p, sha) {
  const files = await listFiles('media/');
  const remove = files.map((f) => f.path).filter((path) => ownFolders(p).some((f) => path.startsWith(f)));
  await commit({
    message: `Delete ${p.type} "${p.title}"`,
    update: p.published ? indexAndSitemap(p, true) : [indexUpdate(p, true)],
    remove: [PROJECT(p.id), ...remove],
    expect: { [PROJECT(p.id)]: sha },
  });
}

export { statusOf };

/* ---------- product library ---------- */
export const libraryUpdate = (product, removeId = null) => ({
  path: LIBRARY,
  fn: (text) => {
    const lib = text ? JSON.parse(text) : { products: [] };
    if (removeId) lib.products = lib.products.filter((x) => x.id !== removeId);
    if (product) {
      const i = lib.products.findIndex((x) => x.id === product.id);
      if (i >= 0) lib.products[i] = product; else lib.products.push(product);
      lib.products.sort((a, b) => a.name.localeCompare(b.name));
    }
    return json(lib);
  },
});

export async function saveLibraryProduct(product, image, oldImage) {
  const put = [];
  if (image) {
    product.image = `media/library/${product.id}-${Date.now().toString(36)}.jpg`;
    put.push({ path: product.image, content: image });
  }
  const remove = oldImage && oldImage !== product.image && oldImage.startsWith('media/library/') ? [oldImage] : [];
  await commit({ message: `Save product "${product.name}"`, put, update: [libraryUpdate(product)], remove });
  put.forEach((f) => rememberLocal(f.path, f.content));
}

export async function deleteLibraryProduct(product) {
  const remove = product.image?.startsWith('media/library/') ? [product.image] : [];
  await commit({ message: `Delete product "${product.name}"`, update: [libraryUpdate(null, product.id)], remove });
}

/* ---------- asset library ---------- */
export async function listAssets() {
  return listFiles('media/');
}

export async function uploadAssets(items, onProgress) {
  // items: [{ path, content }]
  await commit({ message: `Add ${items.length} asset${items.length > 1 ? 's' : ''}`, put: items, onProgress });
  items.forEach((f) => rememberLocal(f.path, f.content));
}

export async function deleteAssets(paths) {
  await commit({ message: `Delete ${paths.length} asset${paths.length > 1 ? 's' : ''}`, remove: paths });
}

export { referenced, isReferenced };
