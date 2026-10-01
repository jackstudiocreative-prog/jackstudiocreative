// Browser-side media processing: resize photos, extract frames from a turntable video,
// prepare panoramas + thumbnails. Everything happens on the team member's computer,
// so the server only receives small, ready-to-use JPGs.

const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function canvasToJpeg(canvas, quality = 0.85) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality));
}

function fitSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * s), Math.round(h * s)];
}

function drawToCanvas(source, w, h, background = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background; // transparent PNGs get a white background
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** Photos → resized JPG frames, ordered by file name (IMG_0001, IMG_0002 …). */
export async function photosToFrames(files, { maxSize = 1200, onProgress } = {}) {
  const list = [...files].filter((f) => f.type.startsWith('image/')).sort(naturalSort);
  const frames = [];
  for (let i = 0; i < list.length; i++) {
    const bmp = await createImageBitmap(list[i]);
    const [w, h] = fitSize(bmp.width, bmp.height, maxSize);
    frames.push(await canvasToJpeg(drawToCanvas(bmp, w, h)));
    bmp.close();
    onProgress?.((i + 1) / list.length);
  }
  return frames;
}

/** Turntable video → N evenly spaced frames. Assumes the clip shows exactly one full turn
 *  between `start` and `end` (seconds). */
export async function videoToFrames(file, { count = 36, maxSize = 1200, start = 0, end = null, onProgress } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('This video format cannot be read by the browser. Try MP4 (H.264).'));
    });
    const duration = video.duration;
    const from = Math.max(0, start);
    const to = Math.min(duration, end ?? duration);
    if (!(to > from)) throw new Error('Video start/end time is not valid');
    const [w, h] = fitSize(video.videoWidth, video.videoHeight, maxSize);
    const step = (to - from) / count; // last frame stops one step before the start angle repeats
    const frames = [];
    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = Math.min(duration - 0.001, from + step * i + 0.001);
      });
      frames.push(await canvasToJpeg(drawToCanvas(video, w, h)));
      onProgress?.((i + 1) / count);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Panorama → { file, thumb, width, height, warning }. Keeps original JPGs untouched when
 *  they are already a reasonable size; otherwise converts / downsizes to 8192 px wide. */
export async function preparePanorama(file) {
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  const ratio = width / height;
  const warning = Math.abs(ratio - 2) > 0.05
    ? `This image is ${width}×${height} (ratio ${ratio.toFixed(2)}:1). A 360° panorama should be 2:1 — it may look stretched.`
    : '';
  let out = file;
  if (file.type !== 'image/jpeg' || width > 8192 || file.size > 25 * 1024 * 1024) {
    const [w, h] = fitSize(width, height, 8192);
    out = await canvasToJpeg(drawToCanvas(bmp, w, h, '#000000'), 0.88);
  }
  const thumb = await canvasToJpeg(drawToCanvas(bmp, 480, 240, '#000000'), 0.8);
  bmp.close();
  return { file: out, thumb, width, height, warning };
}

export function isVideo(file) {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
}
