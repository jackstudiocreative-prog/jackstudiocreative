// Product capture: shoot a product's 360° turn, or its open / close sequence, with a phone.
// Live guides keep every photo lined up — a square frame, a "ghost" of the last photo, a level,
// progress at the top and a status line that says what to do next. The photos go straight into
// a Product 360° project (signed in) or download as a zip.
//
// What the phone's sensors can tell (only shown when the phone reports them):
//   level        — sideways tilt of the camera (deviceorientation) → a turning arrow
//   held still   — how much the phone turned in the last third of a second
//   moved        — which way the phone points compared with the first photo → an arrow back
// Nothing here looks at the picture itself: centring the product is up to the person, helped by the frame.
// The turntable arrow after each photo is an instruction (which way and how far), not a measurement.
import { rotationFromEuler, mat } from './stitch.js';
import { SpinViewer } from '../assets/js/spin-viewer.js';
import { hasToken, whoAmI } from '../studio/js/github.js';
import { loadIndex, loadProject, saveProject, newProject } from '../studio/js/store.js';
import { slugify, uniqueId } from '../studio/js/ui.js';
import { makeZip, saveBlob } from '../studio/js/zip.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MAX_SIDE = 1200;        // same size the Studio resizes uploaded photos to
const MIN_SPIN = 8;           // the Studio needs at least 8 photos for a 360° view
const MIN_ACTION = 3;
const MAX_ACTION = 60;
const LEVEL_DEG = 2;          // "level" tolerance
const MOVED_DEG = 3;          // the phone has turned this far since the first photo → arrow back…
const BACK_DEG = 1;           // …until it is within this of where it was
const SHAKE_DEG = 1.2;        // turned this much within SHAKE_MS → "hold still"
const SHAKE_MS = 350;
const C = { dim: 'rgba(0, 0, 0, 0.62)', line: 'rgba(245, 244, 240, 0.9)', faint: 'rgba(245, 244, 240, 0.28)', green: '#27865A', amber: '#D7A45B', red: '#E0625B' };

const params = new URLSearchParams(location.search);
const st = {
  shoot: params.get('shoot') === 'action' ? 'action' : 'spin',   // what is being shot
  trigger: 'manual',                                             // 'manual' (tap) | 'auto' (timer)
  count: 36, turnSecs: 60, every: 3,
  stream: null, wakeLock: null, raf: 0, cameraLost: false,
  shots: [],                                                     // [{ blob, url }]
  ghost: null, showGhost: false, showGrid: false, busy: false,     // the ghost is optional; it is always shown when retaking
  realign: false, guide: null, turnHint: false,                  // an arrow is showing the way back / which arrow to draw / turntable arrow due
  retake: null,                                                  // index of the photo being taken again
  retakeBack: false,                                             // …and afterwards go straight back to the review screen
  fromReview: false,                                             // the camera was opened again from the review screen
  R: null, R0: null, recent: [],                                 // phone orientation now / at the first photo / the last moments
  auto: { running: false, nextAt: 0, interval: 0 },
  frame: null,                                                   // the square on screen { x, y, side }
  viewer: null, user: null, projects: [], saved: false, photoAt: null,
};
const spin = () => st.shoot === 'spin';
const minPhotos = () => (spin() ? MIN_SPIN : MIN_ACTION);
const isFull = () => (spin() ? st.shots.length >= st.count : st.shots.length >= MAX_ACTION);
const stepDeg = () => { const s = 360 / st.count; return Number.isInteger(s) ? `${s}` : s.toFixed(1); };

function show(id) {
  ['intro', 'live', 'review'].forEach((s) => { $(s).hidden = s !== id; });
}

/* ---------------- 1. Before shooting ---------------- */

const STEPS = {
  spin: {
    manual: () => [
      '<b>Product in the middle of the turntable</b>, on a flat, stable surface.',
      '<b>Phone on a tripod and level</b>, product centred. If the phone moves, an arrow shows the way back.',
      `<b>Turn the turntable the way the arrow shows, then tap.</b> ${st.count} photos make one full turn.`,
    ],
    auto: () => [
      '<b>Product in the middle of the turntable</b>, on a flat, stable surface.',
      '<b>Phone on a tripod and level</b>, product centred. If the phone moves, an arrow shows the way back.',
      `<b>Start the turntable, then press Start.</b> ${st.count} photos are taken during one turn.`,
    ],
  },
  action: {
    manual: () => [
      '<b>Product closed</b>, on a flat, stable surface.',
      '<b>Phone on a tripod and level.</b> If the phone moves, an arrow shows the way back.',
      '<b>Open it a little, hands out of the picture, tap.</b> 8–30 photos is plenty.',
    ],
    auto: () => [
      '<b>Product closed</b>, on a flat, stable surface.',
      '<b>Phone on a tripod and level.</b> If the phone moves, an arrow shows the way back.',
      `<b>Press Start, then open it a little between photos.</b> One every ${st.every} seconds.`,
    ],
  },
};

function readSetup() {
  st.shoot = document.querySelector('input[name="shoot"]:checked').value;
  st.trigger = document.querySelector('input[name="trigger"]:checked').value;
  st.count = Number($('count-sel').value);
  st.turnSecs = clamp(Number($('turn-secs').value) || 60, 10, 900);
  st.every = Number($('every-sel').value);
}

function renderSetup() {
  readSetup();
  const auto = st.trigger === 'auto';
  $('f-count').hidden = !spin();
  $('f-turn').hidden = !(spin() && auto);
  $('f-every').hidden = !(!spin() && auto);
  $('manual-sub').textContent = spin() ? 'Turntable turned by hand' : 'You decide when';
  $('auto-sub').textContent = spin() ? 'Electric turntable' : 'On a timer';
  $('intro-appbar').textContent = spin() ? '360° Capture' : 'Open / close capture';
  STEPS[st.shoot][st.trigger]().forEach((html, i) => { $(`step-${i + 1}`).innerHTML = html; });
  $('options-now').textContent = [spin() ? '360° turn' : 'Open / close', auto ? 'Automatic' : 'Tap', spin() ? `${st.count} photos` : ''].filter(Boolean).join(' · ');
  $('plan').textContent = spin()
    ? auto
      ? `A photo every ${(st.turnSecs / st.count).toFixed(1)} seconds while the turntable makes one full turn in ${st.turnSecs} seconds.`
      : `Turn the turntable ${stepDeg()}° after each photo.`
    : auto
      ? `A photo every ${st.every} seconds until you press Review → Finish.`
      : 'Press Review → Finish when it is fully open.';
}

document.querySelector(`input[name="shoot"][value="${st.shoot}"]`).checked = true;
['count-sel', 'turn-secs', 'every-sel'].forEach((id) => $(id).addEventListener('input', renderSetup));
document.querySelectorAll('input[name="shoot"], input[name="trigger"]').forEach((r) => r.addEventListener('change', renderSetup));
if (params.get('project')) $('leave').href = `../studio/#/project/${encodeURIComponent(params.get('project'))}`;
renderSetup();

function introError(html) {
  $('intro-error').innerHTML = html || '';
  $('intro-error').hidden = !html;
}

/* ---------------- Sensors (optional: a phone without them still shoots, minus the level and movement guides) ---------------- */

const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : window.orientation || 0);

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  st.R = rotationFromEuler(e.alpha, e.beta, e.gamma, screenAngle());
  const now = performance.now();
  st.recent.push({ t: now, R: st.R });
  while (st.recent.length > 2 && now - st.recent[1].t > SHAKE_MS) st.recent.shift();
}
const rollDeg = () => (st.R ? Math.asin(clamp(st.R[6], -1, 1)) / DEG : null); // sideways tilt; > 0 when the right side is higher
const angleBetween = (A, B) => { const M = mat.mul(mat.t(A), B); return Math.acos(clamp((M[0] + M[4] + M[8] - 1) / 2, -1, 1)) / DEG; };
const movedDeg = () => (st.R && st.R0 ? angleBetween(st.R0, st.R) : 0);
/** Where the camera points now compared with the first photo, in degrees: yaw > 0 = further right, pitch > 0 = higher. */
function offsetDeg() {
  if (!st.R || !st.R0) return null;
  const M = mat.mul(mat.t(st.R0), st.R);
  const f = [-M[2], -M[5], -M[8]]; // the camera's direction now, seen from the phone as it was at the first photo
  return { yaw: Math.atan2(f[0], -f[2]) / DEG, pitch: Math.asin(clamp(f[1], -1, 1)) / DEG };
}
function shakeDeg() {
  if (!st.R || st.recent.length < 2 || performance.now() - st.recent[st.recent.length - 1].t > 1000) return 0;
  return angleBetween(st.recent[0].R, st.R);
}

/* ---------------- Camera ---------------- */

const CAMERA_ERRORS = {
  NotAllowedError: '<b>Camera access is blocked.</b> Allow the camera for this site — iPhone: Settings → Safari → Camera; Android: tap the icon left of the address — then press Start Capture again.',
  SecurityError: '<b>Camera access is blocked.</b> Allow the camera for this site in the browser settings, then press Start Capture again.',
  NotFoundError: '<b>No camera found.</b> This device has no camera the browser can use.',
  OverconstrainedError: '<b>No suitable camera found</b> on this device.',
  NotReadableError: '<b>The camera is busy.</b> Close other apps that use the camera, then try again.',
  AbortError: '<b>The camera could not start.</b> Please try again.',
};

/** Camera, sensors and screen wake lock. Must run inside a tap (iOS asks for motion permission then). */
async function openCamera() {
  if (!window.isSecureContext) throw new Error('<b>This page needs a secure address.</b> Open it with https:// — the camera only works on secure connections.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('<b>This browser cannot use the camera.</b> Please use Safari or Chrome.');

  // iOS asks for motion permission; refusing only switches the level and movement guides off
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
  }
  st.R = null; st.recent = [];
  window.addEventListener('deviceorientation', onOrientation);

  try {
    st.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    throw new Error(CAMERA_ERRORS[e.name] || `<b>The camera could not start.</b> ${e.message || ''}`);
  }
  st.cameraLost = false;
  st.stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => { st.cameraLost = true; setAuto(false); }));
  const video = $('video');
  video.srcObject = st.stream;
  await video.play().catch(() => {});
  await waitFor(() => video.videoWidth > 0, 4000, '<b>The camera shows no picture.</b> Please reload the page and try again.');
  st.wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
}

function waitFor(test, ms, message) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => (test() ? resolve() : performance.now() - t0 > ms ? reject(new Error(message)) : setTimeout(tick, 50));
    tick();
  });
}

function stopCamera() {
  cancelAnimationFrame(st.raf);
  st.auto.running = false;
  window.removeEventListener('deviceorientation', onOrientation);
  st.stream?.getTracks().forEach((t) => t.stop());
  st.stream = null;
  st.wakeLock?.release?.().catch(() => {});
  st.wakeLock = null;
}

function resetShots() {
  st.turnHint = false;
  st.realign = false;
  st.shots.forEach((s) => URL.revokeObjectURL(s.url));
  st.shots = [];
  st.ghost = null;
  st.R0 = null;
  st.retake = null;
  st.retakeBack = false;
  st.fromReview = false;
  st.auto.running = false;
  st.saved = false;
  st.projects = [];
}

/** Start from the beginning (the Start Capture button). */
async function start() {
  const btn = $('start');
  introError('');
  readSetup();
  btn.disabled = true;
  btn.textContent = 'Opening camera…';
  try {
    await openCamera();
    resetShots();
    enterLive();
  } catch (e) {
    stopCamera();
    introError(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Start Capture <span aria-hidden="true">→</span>';
  }
}

/** Open the camera again from the review screen: to retake one photo, or to shoot the missing ones. */
async function resumeCamera(retakeIndex = null) {
  try {
    await openCamera();
  } catch (e) {
    stopCamera();
    saveError(e.message.replace(/<[^>]+>/g, ''));
    return;
  }
  st.viewer?.destroy();
  st.viewer = null;
  st.fromReview = true;
  st.R0 = null; // the phone may have been picked up in between
  await setRetake(retakeIndex, retakeIndex != null);
  enterLive();
}

function enterLive() {
  const auto = st.trigger === 'auto';
  st.auto.interval = (spin() ? st.turnSecs / st.count : st.every) * 1000;
  st.auto.running = false;
  $('live-title').textContent = spin() ? '360° Capture' : 'Open / close capture';
  $('bar').setAttribute('aria-valuemax', String(st.count));
  $('ghost').setAttribute('aria-pressed', String(st.showGhost));
  $('grid').setAttribute('aria-pressed', String(st.showGrid));
  show('live');
  setShutter();
  lastStatus = '';
  showStatus();
  layout();
  updateCount();
  loop();
}

async function setRetake(i, back = false) {
  st.retake = i;
  st.retakeBack = back;
  $('top').classList.toggle('is-retake', i != null);
  const shot = i != null ? st.shots[i] : st.shots[st.shots.length - 1];
  // retaking: the ghost is the photo being replaced, so the product can be turned back to that exact angle
  st.ghost = shot ? await createImageBitmap(shot.blob).catch(() => null) : null;
  setShutter();
  updateCount();
}

/* ---------------- Live view ---------------- */

/** The square that is photographed: as large as fits between the top bar, the status line and the controls.
 *  The video is sized so the square shows the full short side of the camera picture — what is
 *  inside the square is exactly what is saved. */
function layout() {
  const video = $('video');
  const W = window.innerWidth, H = window.innerHeight;
  const top = $('top').getBoundingClientRect(), ctl = $('controls').getBoundingClientRect(), status = $('status');
  const side_ = ctl.left > W / 2; // landscape: the controls run down the right edge
  const area = { left: 0, top: top.bottom, right: side_ ? ctl.left : W, bottom: side_ ? H : ctl.top };
  const pad = 10, pillH = status.offsetHeight || 52;
  const availW = area.right - area.left - pad * 2, availH = area.bottom - area.top - pad * 2;
  const roomy = Math.min(availW, availH - pillH - pad);
  const full = Math.min(availW, availH);
  let side, pillTop;
  if (roomy >= full * 0.82) { // the status line fits under the square, clear of the product
    side = Math.floor(roomy);
    const y = area.top + pad + (availH - pillH - pad - side) / 2;
    st.frame = { x: Math.round(area.left + (area.right - area.left - side) / 2), y: Math.round(y), side };
    pillTop = st.frame.y + side + pad;
  } else { // short screens: the status line sits on the bottom edge of the square
    side = Math.floor(full);
    st.frame = { x: Math.round(area.left + (area.right - area.left - side) / 2), y: Math.round(area.top + pad + (availH - side) / 2), side };
    pillTop = st.frame.y + side - pillH - 10;
  }
  status.style.top = `${Math.round(pillTop)}px`;
  status.style.left = `${Math.round(st.frame.x + side / 2)}px`;
  status.style.width = `${Math.min(side - 16, 440)}px`;
  $('captured').style.top = `${st.frame.y + Math.max(28, side * 0.08) + 22}px`; // just under the level bar
  $('captured').style.left = `${Math.round(st.frame.x + side / 2)}px`;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = side / Math.min(vw, vh);
  video.style.width = `${vw * s}px`;
  video.style.height = `${vh * s}px`;
  video.style.left = `${st.frame.x + side / 2 - (vw * s) / 2}px`;
  video.style.top = `${st.frame.y + side / 2 - (vh * s) / 2}px`;
}
window.addEventListener('resize', () => { if (!$('live').hidden) layout(); });
screen.orientation?.addEventListener?.('change', () => setTimeout(() => { if (!$('live').hidden) layout(); }, 120));

function loop() {
  st.raf = requestAnimationFrame(loop);
  const video = $('video');
  if (video.videoWidth && (!st.frame || video.videoWidth !== st.lastVW)) { st.lastVW = video.videoWidth; layout(); }
  draw();
  autoShoot();
  showStatus();
}

function draw() {
  const cv = $('overlay'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!st.frame) return;
  const { x, y, side } = st.frame;

  // everything outside the square is not in the photo
  ctx.fillStyle = C.dim;
  ctx.fillRect(0, 0, W, y);
  ctx.fillRect(0, y + side, W, H - y - side);
  ctx.fillRect(0, y, x, side);
  ctx.fillRect(x + side, y, W - x - side, side);

  // ghost of the last photo (or of the photo being retaken): the product should sit exactly on top of it
  if ((st.showGhost || st.retake != null) && st.ghost) {
    ctx.globalAlpha = 0.4;
    ctx.drawImage(st.ghost, x, y, side, side);
    ctx.globalAlpha = 1;
  }

  // optional grid in thirds; the centre line (the turntable's axis) is always there, faintly
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.faint;
  ctx.beginPath();
  if (st.showGrid) {
    [1, 2].forEach((k) => {
      ctx.moveTo(x + (side * k) / 3, y); ctx.lineTo(x + (side * k) / 3, y + side);
      ctx.moveTo(x, y + (side * k) / 3); ctx.lineTo(x + side, y + (side * k) / 3);
    });
  }
  ctx.moveTo(x + side / 2, y + side * 0.14); ctx.lineTo(x + side / 2, y + side * 0.86);
  ctx.stroke();

  // corner marks only: light framing that keeps the product visible
  const roll = rollDeg();
  const level = roll != null && Math.abs(roll) <= LEVEL_DEG;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const c = Math.max(18, side * 0.08), m = 8;
  [[x + m, y + m, 1, 1], [x + side - m, y + m, -1, 1], [x + m, y + side - m, 1, -1], [x + side - m, y + side - m, -1, -1]].forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + sx * c, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * c);
    ctx.stroke();
  });

  // level: a bar near the top that tilts with the phone, green when level
  if (roll != null) {
    const lx = x + side / 2, ly = y + Math.max(28, side * 0.08), half = Math.min(70, side * 0.2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(245, 244, 240, 0.55)';
    ctx.beginPath();
    ctx.moveTo(lx - half - 18, ly); ctx.lineTo(lx - half - 6, ly);
    ctx.moveTo(lx + half + 6, ly); ctx.lineTo(lx + half + 18, ly);
    ctx.stroke();
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(clamp(roll, -30, 30) * DEG); // stays level with the world: right side of the phone up → the bar turns clockwise
    ctx.strokeStyle = level ? C.green : C.amber;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-half, 0); ctx.lineTo(-9, 0); ctx.moveTo(9, 0); ctx.lineTo(half, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.lineCap = 'butt';
  drawGuide(ctx, x, y, side);

  // automatic shooting: the Start/Pause button fills up as the next photo approaches
  if (st.trigger === 'auto' && st.retake == null) {
    const left = st.auto.running ? clamp((st.auto.nextAt - performance.now()) / st.auto.interval, 0, 1) : 1;
    $('shutter').style.setProperty('--p', String(Math.round((1 - left) * 100)));
  }
}

/* ---------- arrows ---------- */

const pulse = () => 0.65 + 0.35 * Math.sin(performance.now() / 180);

/** A thick arrow pointing `dir` ('left' | 'right' | 'up' | 'down'), centred on (cx, cy). */
function straightArrow(ctx, cx, cy, size, dir, color) {
  const a = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  const L = size, H = size * 0.55, T = size * 0.2; // length, head width, shaft width
  ctx.beginPath();
  ctx.moveTo(-L / 2, -T / 2); ctx.lineTo(L / 2 - H * 0.8, -T / 2); ctx.lineTo(L / 2 - H * 0.8, -H / 2);
  ctx.lineTo(L / 2, 0);
  ctx.lineTo(L / 2 - H * 0.8, H / 2); ctx.lineTo(L / 2 - H * 0.8, T / 2); ctx.lineTo(-L / 2, T / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(23, 26, 29, 0.55)';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Part of an ellipse (radii rx, ry) with an arrow head at `to`. Angles in radians; `cw` = clockwise on screen. */
function curvedArrow(ctx, cx, cy, rx, ry, from, to, cw, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(23, 26, 29, 0.55)';
  ctx.shadowBlur = 4;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, from, to, !cw);
  ctx.stroke();
  // the head at `to`, pointing the way of travel
  const px = cx + Math.cos(to) * rx, py = cy + Math.sin(to) * ry;
  let tx = -Math.sin(to) * rx, ty = Math.cos(to) * ry;
  if (!cw) { tx = -tx; ty = -ty; }
  const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
  const h = width * 2.4;
  ctx.beginPath();
  ctx.moveTo(px + tx * h, py + ty * h);
  ctx.lineTo(px - tx * h * 0.35 - ty * h * 0.75, py - ty * h * 0.35 + tx * h * 0.75);
  ctx.lineTo(px - tx * h * 0.35 + ty * h * 0.75, py - ty * h * 0.35 - tx * h * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function label(ctx, text, cx, cy, size) {
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(23, 26, 29, 0.7)';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, cy);
}

/** The arrow chosen by statusNow(): back to where the phone was, level it, or turn the turntable. */
function drawGuide(ctx, x, y, side) {
  const g = st.guide;
  if (!g) return;
  ctx.globalAlpha = g === 'turntable' ? 0.95 : pulse();
  if (g === 'left' || g === 'right' || g === 'up' || g === 'down') {
    // near the edge the phone should turn towards
    const m = side * 0.17;
    const pos = { left: [x + m, y + side / 2], right: [x + side - m, y + side / 2], up: [x + side / 2, y + m + side * 0.06], down: [x + side / 2, y + side - m] }[g];
    straightArrow(ctx, pos[0], pos[1], side * 0.2, g, C.red);
  } else if (g === 'cw' || g === 'ccw') {
    // around the level bar: turn the phone this way until the bar goes green
    const ly = y + Math.max(28, side * 0.08), r = Math.min(70, side * 0.2) + 26;
    const cw = g === 'cw';
    curvedArrow(ctx, x + side / 2, ly + r * 0.7, r, r * 0.6, cw ? Math.PI * 1.2 : Math.PI * 1.8, cw ? Math.PI * 1.72 : Math.PI * 1.28, cw, C.amber, 6);
  } else if (g === 'turntable') {
    // under the product: an arc along the front of the turntable, same way every time
    const cy = y + side * 0.74, rx = side * 0.3, ry = side * 0.08;
    curvedArrow(ctx, x + side / 2, cy, rx, ry, Math.PI * 0.85, Math.PI * 0.15, false, C.amber, 7);
    label(ctx, `Turn ${stepDeg()}°`, x + side / 2, cy + ry + 22, Math.max(15, side * 0.05));
  }
  ctx.globalAlpha = 1;
}

/** What to do next, in a few words. */
function instruction() {
  const n = st.shots.length, auto = st.trigger === 'auto';
  if (st.retake != null) return 'Turn the product back to match the ghost, then tap';
  if (auto && st.auto.running) {
    const secs = Math.max(0, (st.auto.nextAt - performance.now()) / 1000);
    return spin() ? 'Shooting — keep clear of the turntable' : secs > 1.2 ? `Open it a little — next photo in ${Math.ceil(secs)}` : 'Hands out of the picture';
  }
  if (auto) return n ? 'Paused — press Start to carry on' : spin() ? 'Start the turntable, then press Start' : 'Product closed? Press Start';
  if (!n) return spin() ? 'Keep the product centred, then tap' : 'Product closed? Tap for the first photo';
  return spin() ? `Turn the turntable ${stepDeg()}° the way the arrow shows, then tap` : 'Open it a little more, hands out, then tap';
}

function statusNow() {
  const s = statusParts();
  // the turntable arrow, when nothing more urgent needs an arrow
  st.guide = s.arrow || (st.turnHint && st.retake == null && (s.tone === 'ready' || s.tone === 'neutral') ? 'turntable' : null);
  return s;
}

function statusParts() {
  const n = st.shots.length, sub = instruction();
  if (st.cameraLost) return { tone: 'error', title: 'The camera stopped', sub: 'Press × and start again — your photos are kept until you close' };
  if (st.busy) return { tone: 'busy', title: 'Capturing…', sub: 'Hold still' };
  const roll = rollDeg();
  if (roll == null) return { tone: 'neutral', title: 'Keep the phone still and level', sub }; // no motion sensor (or not allowed): no arrows either
  if (shakeDeg() > SHAKE_DEG) return { tone: 'error', title: 'Too much movement · Hold still', sub: st.auto.running ? 'Photos are still being taken' : 'Wait until the phone is steady' };
  // moved since the first photo: point the way back, and keep pointing until it is nearly where it was
  const off = n && st.retake == null ? offsetDeg() : null;
  const moved = off ? Math.hypot(off.yaw, off.pitch) : 0;
  st.realign = off ? (st.realign ? moved > BACK_DEG : moved > MOVED_DEG) : false;
  if (st.realign) {
    const sideways = Math.abs(off.yaw) >= Math.abs(off.pitch);
    const arrow = sideways ? (off.yaw > 0 ? 'left' : 'right') : (off.pitch > 0 ? 'down' : 'up');
    const words = { left: 'Turn the phone back left', right: 'Turn the phone back right', up: 'Tilt the phone back up', down: 'Tilt the phone back down' };
    return { tone: 'error', title: `The phone has moved · ${words[arrow]}`, sub: 'Follow the arrow until this turns green', arrow };
  }
  if (Math.abs(roll) > LEVEL_DEG) return { tone: 'adjust', title: `Tilt phone slightly ${roll > 0 ? 'right' : 'left'}`, sub: 'Follow the curved arrow until the line is green', arrow: roll > 0 ? 'cw' : 'ccw' };
  return { tone: 'ready', title: st.auto.running ? 'Phone level · Shooting' : 'Phone level · Ready to capture', sub };
}

let lastStatus = '';
function showStatus() {
  const s = statusNow();
  const key = `${s.tone}|${s.title}|${s.sub}`;
  if (key === lastStatus) return;
  lastStatus = key;
  $('status').dataset.tone = s.tone;
  $('status-title').textContent = s.title;
  $('status-sub').textContent = s.sub;
}

/* ---------------- Taking photos ---------------- */

function grab() {
  const video = $('video');
  const vw = video.videoWidth, vh = video.videoHeight;
  const side = Math.min(vw, vh), out = Math.min(side, MAX_SIDE);
  const cv = document.createElement('canvas');
  cv.width = cv.height = out;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
  return cv;
}

let capturedTimer = 0;
function confirmShot(text) {
  $('captured-text').textContent = text;
  $('captured').hidden = false;
  requestAnimationFrame(() => $('captured').classList.add('is-on'));
  clearTimeout(capturedTimer);
  capturedTimer = setTimeout(() => {
    $('captured').classList.remove('is-on');
    capturedTimer = setTimeout(() => { $('captured').hidden = true; }, 220);
  }, 900);
}

async function shoot() {
  if (st.busy || $('live').hidden || st.cameraLost) return;
  const retaking = st.retake != null;
  if (!retaking && isFull()) return;
  st.busy = true;
  setShutter();
  showStatus();
  try {
    const cv = grab();
    const flash = $('flash');
    flash.classList.add('is-on');
    setTimeout(() => flash.classList.remove('is-on'), 60);
    navigator.vibrate?.(20);
    const blob = await new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the photo. Please try again.'))), 'image/jpeg', 0.88));
    const shot = { blob, url: URL.createObjectURL(blob) };
    if (retaking) {
      const i = st.retake;
      URL.revokeObjectURL(st.shots[i].url);
      st.shots[i] = shot;
      st.retake = null;
      $('top').classList.remove('is-retake');
      confirmShot(`Photo ${i + 1} replaced`);
      if (st.retakeBack) { finish(); return; }
      const last = st.shots[st.shots.length - 1];
      st.ghost = last === shot ? cv : await createImageBitmap(last.blob).catch(() => null);
    } else {
      st.shots.push(shot);
      st.ghost = cv;
      st.turnHint = spin() && st.trigger === 'manual';
      if (!st.R0 && st.R) st.R0 = st.R;
      confirmShot(spin() ? `Photo ${st.shots.length} of ${st.count} captured` : `Photo ${st.shots.length} captured`);
    }
    updateCount();
    if (!retaking && isFull()) finish();
  } catch (e) {
    setAuto(false);
    $('status').dataset.tone = 'error';
    $('status-title').textContent = 'That photo did not work';
    $('status-sub').textContent = `${e.message} Tap the button to try again.`;
    lastStatus = '';
  } finally {
    st.busy = false;
    setShutter();
  }
}

function autoShoot() {
  const a = st.auto;
  if (!a.running || st.busy || st.retake != null) return;
  const now = performance.now();
  if (now < a.nextAt) return;
  a.nextAt = Math.max(a.nextAt + a.interval, now + a.interval * 0.5); // keeps the rhythm, never bunches up after a stall
  shoot();
}

function setAuto(on) {
  st.auto.running = on;
  // a 360° turn takes its first photo at once (the turntable is already moving);
  // an opening sequence gives the first one straight away too, then time to open it between photos
  st.auto.nextAt = performance.now();
  setShutter();
}

/** The shutter: tap for a photo, or Start / Pause for automatic shooting (a retake is always one tap). */
function setShutter() {
  const b = $('shutter');
  const auto = st.trigger === 'auto' && st.retake == null;
  b.classList.toggle('is-auto', auto);
  b.classList.toggle('is-running', auto && st.auto.running);
  b.classList.toggle('is-busy', st.busy && !auto);
  b.disabled = st.cameraLost || (!auto && st.busy) || (st.retake == null && isFull());
  $('shutter-text').textContent = auto ? (st.auto.running ? 'Pause' : 'Start') : '';
  b.setAttribute('aria-label', auto ? (st.auto.running ? 'Pause' : 'Start taking photos') : st.retake != null ? `Retake photo ${st.retake + 1}` : 'Take photo');
}

function updateCount() {
  const n = st.shots.length;
  const pct = spin() ? Math.round((n / st.count) * 100) : 0;
  if (st.retake != null) {
    $('count-text').textContent = `Retake photo ${st.retake + 1}${spin() ? ` of ${st.count}` : ''}`;
    $('remaining').textContent = 'The new photo replaces the old one';
  } else if (spin()) {
    $('count-text').textContent = `${n} / ${st.count} Photos`;
    const left = st.count - n;
    $('remaining').textContent = left ? `${left} photo${left === 1 ? '' : 's'} remaining` : 'All photos taken';
  } else {
    $('count-text').textContent = `${n} Photo${n === 1 ? '' : 's'}`;
    $('remaining').textContent = n ? 'Press Review → Finish when it is fully open' : 'First photo: fully closed';
  }
  $('percent').textContent = spin() ? `${pct}%` : '';
  $('bar').hidden = !spin();
  $('bar-fill').style.width = `${pct}%`;
  $('bar').setAttribute('aria-valuenow', String(n));
  $('undo').disabled = !n || st.retake != null;
  $('review-btn').disabled = !n;
  const last = st.shots[n - 1];
  const thumb = $('review-thumb');
  thumb.style.backgroundImage = last ? `url("${last.url}")` : '';
  thumb.classList.remove('is-pop');
  if (last) { void thumb.offsetWidth; thumb.classList.add('is-pop'); }
  $('review-label').textContent = n ? `Review (${n})` : 'Review';
  setShutter();
}

$('shutter').addEventListener('click', () => {
  if (st.trigger === 'auto' && st.retake == null) setAuto(!st.auto.running);
  else shoot();
});
$('undo').addEventListener('click', async () => {
  if (st.auto.running) setAuto(false);
  const gone = st.shots.pop();
  st.turnHint = spin() && st.trigger === 'manual' && st.shots.length > 0;
  if (gone) URL.revokeObjectURL(gone.url);
  const last = st.shots[st.shots.length - 1];
  st.ghost = last ? await createImageBitmap(last.blob).catch(() => null) : null;
  if (!last) st.R0 = null;
  updateCount();
});
$('ghost').addEventListener('click', () => {
  st.showGhost = !st.showGhost;
  $('ghost').setAttribute('aria-pressed', String(st.showGhost));
});
$('grid').addEventListener('click', () => {
  st.showGrid = !st.showGrid;
  $('grid').setAttribute('aria-pressed', String(st.showGrid));
});
$('cancel').addEventListener('click', () => {
  if (st.fromReview) { // back to the review screen; photos taken just now are kept
    stopCamera();
    st.retake = null;
    $('top').classList.remove('is-retake');
    finish();
    return;
  }
  if (st.shots.length && !confirm('Discard these photos?')) return;
  stopCamera();
  resetShots();
  show('intro');
});
$('start').addEventListener('click', start);

/* ---------------- Photos so far (without leaving the camera) ---------------- */

function thumbsHTML(withMissing) {
  const tiles = st.shots.map((s, i) => `
    <li><button type="button" data-photo="${i}" aria-label="Photo ${i + 1} — open to retake"><img src="${s.url}" alt="" loading="lazy"></button><span class="pc-num">${i + 1}</span></li>`);
  if (withMissing && spin()) {
    for (let i = st.shots.length; i < st.count; i++) tiles.push(`<li><span class="is-missing">${i + 1}<br>missing</span></li>`);
  }
  return tiles.join('');
}

function openSheet() {
  if (st.auto.running) setAuto(false);
  const n = st.shots.length, enough = n >= minPhotos();
  $('sheet-thumbs').innerHTML = thumbsHTML(false);
  $('sheet-sub').textContent = spin()
    ? `${n} of ${st.count} taken. Tap a photo to retake it.${enough ? '' : ` At least ${MIN_SPIN} are needed to finish.`}`
    : `${n} taken. Tap a photo to retake it.${enough ? '' : ` At least ${MIN_ACTION} are needed to finish.`}`;
  $('finish').disabled = !enough;
  $('finish').textContent = spin() && n < st.count ? `Finish with ${n}` : 'Finish';
  $('sheet').hidden = false;
  $('sheet-close').focus();
}
const closeSheet = () => { $('sheet').hidden = true; $('review-btn').focus(); };
$('review-btn').addEventListener('click', openSheet);
$('sheet-close').addEventListener('click', closeSheet);
$('sheet-back').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
$('sheet-thumbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-photo]');
  if (b) openPhoto(Number(b.dataset.photo), 'live');
});
$('finish').addEventListener('click', () => {
  const missing = st.count - st.shots.length;
  if (spin() && missing > 0 && !confirm(`${st.shots.length} of ${st.count} photos — the turn will have a gap. Finish anyway? You can shoot the missing ones from the review.`)) return;
  $('sheet').hidden = true;
  finish();
});

/* one photo, large */
function openPhoto(i, from) {
  st.photoAt = { i, from };
  $('photo-title').textContent = `Photo ${i + 1}${spin() ? ` of ${st.count}` : ''}`;
  $('photo-img').src = st.shots[i].url;
  $('photo-sub').textContent = spin()
    ? 'Blurred, or the product shifted? Retake it: turn the turntable back to this angle — the old photo shows as a ghost to line up with.'
    : 'Retake it: put the product back to this stage — the old photo shows as a ghost to line up with.';
  $('photo').hidden = false;
  $('photo-retake').focus();
}
const closePhoto = () => { $('photo').hidden = true; st.photoAt = null; };
$('photo-close').addEventListener('click', closePhoto);
$('photo-cancel').addEventListener('click', closePhoto);
$('photo').addEventListener('click', (e) => { if (e.target === $('photo')) closePhoto(); });
$('photo-retake').addEventListener('click', () => {
  const { i, from } = st.photoAt;
  closePhoto();
  if (from === 'live') { $('sheet').hidden = true; setRetake(i); }
  else resumeCamera(i);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('photo').hidden) closePhoto();
  else if (!$('sheet').hidden) closeSheet();
});

/* ---------------- Review and save ---------------- */

function setProgress(v) {
  $('save-progress').hidden = v == null;
  if (v != null) $('save-progress').firstElementChild.style.width = `${Math.round(v * 100)}%`;
}
function saveError(message) {
  $('save-error').textContent = message || '';
  $('save-error').hidden = !message;
}

async function finish() {
  stopCamera();
  st.retake = null;
  st.retakeBack = false;
  st.fromReview = false;
  show('review');
  saveError('');
  setProgress(null);
  st.viewer?.destroy();
  $('stage').innerHTML = '';
  const n = st.shots.length, urls = st.shots.map((s) => s.url);
  // the same viewer customers get: a spin to drag, or the opening played from its hotspot
  st.viewer = spin()
    ? new SpinViewer($('stage'), urls, { label: 'Your 360° photos' })
    : new SpinViewer($('stage'), [urls[0]], { label: 'Your open / close photos', hint: 'Press Open to play', action: { frames: urls, frame: 1, x: 0.5, y: 0.5, span: 99 } });

  const missing = spin() ? Math.max(0, st.count - n) : 0;
  $('done-line').textContent = spin()
    ? missing ? `${n} of ${st.count} photos · ${missing} missing` : `${n} photos completed`
    : `${n} photos taken`;
  $('done-line').classList.toggle('is-short', missing > 0);
  const size = st.shots.reduce((a, s) => a + s.blob.size, 0);
  $('review-info').textContent = `${(size / 1024 / 1024).toFixed(1)} MB · ${spin() ? 'drag to turn it' : 'press Open to play it'} · tap a photo below to retake it`;
  $('review-thumbs').innerHTML = thumbsHTML(true);
  $('missing').hidden = !missing;
  $('missing').textContent = `Shoot the missing ${missing === 1 ? 'photo' : `${missing} photos`}`;

  const save = $('save'), signedIn = hasToken(), enough = n >= minPhotos();
  save.hidden = !signedIn;
  save.disabled = !enough || st.saved;
  save.textContent = st.saved ? 'Saved ✓' : 'Complete & Save';
  $('save-box').hidden = !signedIn || st.saved;
  $('download').classList.toggle('pc-btn--primary', !signedIn);
  $('download').classList.toggle('pc-btn--ghost', signedIn);
  if (!signedIn) {
    $('review-note').innerHTML = `Download the photos, then upload them in the Studio under ${spin() ? '<b>Multi-angle photos</b>' : '<b>Open / close</b>'}. To save straight from this phone next time, <a href="../studio/">sign in to the Studio</a> here first and tick “Keep me signed in”.`;
    return;
  }
  if (st.saved) return;
  $('review-note').textContent = missing
    ? `The turn has a gap of ${missing}. Shoot the missing photos first, or save as it is. Saving keeps the photos as a draft — nothing goes public until you publish in the Studio.`
    : 'Saving keeps the photos as a draft. Nothing goes public until you publish in the Studio.';
  try { if (!st.projects.length) await loadProjects(); }
  catch (e) { saveError(`Could not load your projects: ${e.message}`); save.hidden = true; }
}

$('review-thumbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-photo]');
  if (b) openPhoto(Number(b.dataset.photo), 'review');
});
$('missing').addEventListener('click', () => resumeCamera(null));

async function loadProjects() {
  const sel = $('project');
  sel.innerHTML = '<option value="">Loading…</option>';
  const index = await loadIndex();
  st.projects = index.projects;
  const products = index.projects.filter((p) => p.type === 'product');
  const wanted = params.get('project');
  sel.innerHTML = `<option value="">Choose a project…</option>${
    products.map((p) => `<option value="${escapeAttr(p.id)}">${escapeText(p.title)}</option>`).join('')}${
    spin() ? '<option value="__new">+ New product project…</option>' : ''}`;
  if (wanted && products.some((p) => p.id === wanted)) sel.value = wanted;
  else if (!products.length && spin()) sel.value = '__new';
  $('f-new').hidden = sel.value !== '__new';
}
const escapeText = (s = '') => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escapeAttr = (s = '') => escapeText(s).replace(/"/g, '&quot;');
$('project').addEventListener('change', () => { $('f-new').hidden = $('project').value !== '__new'; saveError(''); });

async function saveToProject() {
  const choice = $('project').value;
  if (!choice) throw new Error('Choose the project these photos belong to.');
  const user = st.user || (st.user = await whoAmI());
  let p, sha = null;
  if (choice === '__new') {
    const title = $('new-name').value.trim();
    if (!title) throw new Error('Give the new project a name.');
    p = newProject('product', title, user, uniqueId(slugify(title) || 'product', new Set(st.projects.map((x) => x.id))));
  } else {
    ({ project: p, sha } = await loadProject(choice));
    if (p.type !== 'product') throw new Error('That is not a Product 360° project.');
  }
  const d = p.draft;
  if (!spin() && !d.spin) throw new Error('This project has no 360° photos yet. Shoot the 360° turn first, then the open / close photos.');

  const n = st.shots.length, pad = Math.max(2, String(n).length);
  const folder = `media/products/${p.id}/${spin() ? 'spin' : 'action'}-${Date.now().toString(36)}`;
  const put = st.shots.map((s, i) => ({ path: `${folder}/frame-${String(i + 1).padStart(pad, '0')}.jpg`, content: s.blob }));
  const files = { folder, pattern: 'frame-{n}.jpg', count: n, pad };
  if (spin()) {
    d.spin = { ...files, ...(d.spin?.reverse ? { reverse: true } : {}) };
    if (d.action) d.action.frame = clamp(d.action.frame || 1, 1, n); // the opening sequence keeps a valid angle
  } else {
    const old = d.action || {};
    d.action = {
      ...files,
      frame: clamp(old.frame || 1, 1, d.spin.count), x: old.x ?? 0.5, y: old.y ?? 0.5, span: old.span ?? 2,
      ...(old.label ? { label: old.label } : {}), ...(old.closeLabel ? { closeLabel: old.closeLabel } : {}),
    };
  }
  await saveProject(p, user, {
    sha, put, onProgress: setProgress,
    message: `Add ${spin() ? '360° photos' : 'open / close photos'} to "${p.title}" from phone capture`,
  });
  return p;
}

$('save').addEventListener('click', async () => {
  const save = $('save');
  const missing = spin() ? st.count - st.shots.length : 0;
  if (missing > 0 && !confirm(`${missing} photo${missing === 1 ? ' is' : 's are'} missing, so the turn will jump there. Save anyway?`)) return;
  saveError('');
  save.disabled = true;
  save.textContent = 'Saving…';
  try {
    const p = await saveToProject();
    st.saved = true;
    save.textContent = 'Saved ✓';
    $('save-box').hidden = true;
    $('missing').hidden = true;
    $('review-note').innerHTML = `Saved to “${escapeText(p.title)}” as a draft. <a href="../studio/#/project/${encodeURIComponent(p.id)}">Open it in the Studio</a>${
      !spin() ? ' to choose the angle and place the hotspot' : ''}. If the project is open on a computer, reload that page first.`;
  } catch (e) {
    save.disabled = false;
    save.textContent = 'Complete & Save';
    saveError(e.message);
  } finally {
    setProgress(null);
  }
});

$('download').addEventListener('click', async () => {
  const btn = $('download');
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const pad = Math.max(2, String(st.shots.length).length);
    const zip = await makeZip(st.shots.map((s, i) => ({ name: `frame-${String(i + 1).padStart(pad, '0')}.jpg`, blob: s.blob })));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    saveBlob(zip, `jackstudio-${spin() ? '360' : 'open-close'}-${stamp}.zip`);
  } catch (e) {
    saveError(`Download failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download photos';
  }
});

function again() {
  if (!st.saved && !confirm('Discard these photos and shoot again?')) return;
  st.viewer?.destroy();
  st.viewer = null;
  resetShots();
  show('intro');
}
$('again').addEventListener('click', again);
$('again-x').addEventListener('click', again);

// closing the tab by mistake would lose the photos (they only live in this page until saved or downloaded)
window.addEventListener('beforeunload', (e) => {
  if (st.shots.length && !st.saved) { e.preventDefault(); e.returnValue = ''; }
});
