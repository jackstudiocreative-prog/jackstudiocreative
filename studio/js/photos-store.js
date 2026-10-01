// Photo library data: originals + thumbnails in the private photo repository, indexed in photos.json
import { photos } from './github.js';

const INDEX = 'photos.json';
const json = (o) => JSON.stringify(o, null, 2) + '\n';
export const MAX_FILE = 50 * 1024 * 1024;     // per photo (GitHub's hard limit is 100 MB)
const BATCH_BYTES = 60 * 1024 * 1024;         // per commit
const BATCH_FILES = 15;

export const normalizeSku = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '');

/** "JS1023_front.jpg" → "JS1023", "JS1023-BRN 2.jpg" → "JS1023-BRN" */
const CAMERA_NAMES = /^(IMG|DSC|DSCF|DSCN|PXL|MVIMG|PHOTO|IMAGE|SCREENSHOT|WHATSAPP|GOPR|DJI|P\d{3,})$/;
export const skuFromFileName = (name) => {
  const sku = normalizeSku(name.replace(/\.[^.]+$/, '').split(/[_\s(]/)[0]);
  return CAMERA_NAMES.test(sku) ? '' : sku; // camera file names carry no SKU — leave it for the uploader
};

const safeName = (name) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'photo';

export async function loadPhotoIndex() {
  const { data } = await photos.readJSON(INDEX);
  return data || { photos: [] };
}

/** Small JPEG preview for the grid (long side 600px). Returns null for formats the browser can't read (e.g. HEIC). */
export async function makeThumb(file) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const out = { thumb: blob, width: bmp.width, height: bmp.height };
    bmp.close?.();
    return out;
  } catch {
    return { thumb: null, width: null, height: null };
  }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * items: [{ file, sku, tags: [] }] — originals are stored unchanged.
 * Uploads in several commits so a large batch doesn't become one huge request.
 */
export async function uploadPhotos(items, user, onProgress) {
  const prepared = [];
  for (const it of items) {
    const sku = normalizeSku(it.sku) || 'UNSORTED';
    const id = newId();
    const { thumb, width, height } = it.thumbInfo || (await makeThumb(it.file));
    prepared.push({
      it, thumb,
      entry: {
        id, sku, name: it.file.name, tags: it.tags || [],
        file: `photos/${sku}/${id}-${safeName(it.file.name)}`,
        thumb: thumb ? `thumbs/${sku}/${id}.jpg` : null,
        size: it.file.size, type: it.file.type || '', width, height,
        uploadedBy: user.login, uploadedAt: new Date().toISOString(),
      },
    });
  }

  const batches = [];
  let cur = [], bytes = 0;
  for (const p of prepared) {
    if (cur.length && (bytes + p.it.file.size > BATCH_BYTES || cur.length >= BATCH_FILES)) { batches.push(cur); cur = []; bytes = 0; }
    cur.push(p); bytes += p.it.file.size;
  }
  if (cur.length) batches.push(cur);

  let done = 0;
  const totalBytes = prepared.reduce((a, p) => a + p.it.file.size, 0) || 1;
  for (const batch of batches) {
    const put = [];
    for (const p of batch) {
      put.push({ path: p.entry.file, content: p.it.file });
      if (p.thumb) put.push({ path: p.entry.thumb, content: p.thumb });
    }
    const batchBytes = batch.reduce((a, p) => a + p.it.file.size, 0);
    await photos.commit({
      message: `Add ${batch.length} photo${batch.length > 1 ? 's' : ''} (${[...new Set(batch.map((p) => p.entry.sku))].join(', ')})`,
      put,
      update: [{ path: INDEX, fn: (text) => {
        const idx = text ? JSON.parse(text) : { photos: [] };
        idx.photos.push(...batch.map((p) => p.entry));
        return json(idx);
      } }],
      onProgress: (x) => onProgress?.((done + batchBytes * x) / totalBytes),
    });
    batch.forEach((p) => { if (p.thumb) cacheThumb(p.entry.thumb, p.thumb); });
    done += batchBytes;
    onProgress?.(done / totalBytes);
  }
  return prepared.map((p) => p.entry);
}

export async function updatePhotos(ids, changes) {
  const set = new Set(ids);
  await photos.commit({
    message: `Update ${ids.length} photo${ids.length > 1 ? 's' : ''}`,
    update: [{ path: INDEX, fn: (text) => {
      const idx = text ? JSON.parse(text) : { photos: [] };
      idx.photos.forEach((p) => {
        if (!set.has(p.id)) return;
        if (changes.sku !== undefined) p.sku = normalizeSku(changes.sku) || 'UNSORTED';
        if (changes.tags !== undefined) p.tags = changes.tags;
      });
      return json(idx);
    } }],
  });
}

export async function deletePhotos(list) {
  const ids = new Set(list.map((p) => p.id));
  await photos.commit({
    message: `Delete ${list.length} photo${list.length > 1 ? 's' : ''}`,
    remove: list.flatMap((p) => [p.file, p.thumb].filter(Boolean)),
    update: [{ path: INDEX, fn: (text) => {
      const idx = text ? JSON.parse(text) : { photos: [] };
      idx.photos = idx.photos.filter((p) => !ids.has(p.id));
      return json(idx);
    } }],
  });
}

/* ---------- previews (cached in the browser so they aren't downloaded twice) ---------- */
const memory = new Map();
const CACHE = 'js360-photo-thumbs-v1';
const cacheKey = (path) => `https://cache.local/${path}`;

async function cacheThumb(path, blob) {
  memory.set(path, URL.createObjectURL(blob));
  try { (await caches.open(CACHE)).put(cacheKey(path), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })); } catch {}
}

let active = 0;
const queue = [];
const slot = () => new Promise((res) => { if (active < 6) { active++; res(); } else queue.push(res); });
const release = () => { const next = queue.shift(); if (next) next(); else active--; };

export async function thumbURL(photo) {
  if (!photo.thumb) return null;
  if (memory.has(photo.thumb)) return memory.get(photo.thumb);
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(photo.thumb));
    if (hit) { const url = URL.createObjectURL(await hit.blob()); memory.set(photo.thumb, url); return url; }
  } catch {}
  await slot();
  try {
    const blob = await photos.getRaw(photo.thumb);
    await cacheThumb(photo.thumb, blob);
    return memory.get(photo.thumb);
  } finally { release(); }
}

export const original = (photo) => photos.getRaw(photo.file);
