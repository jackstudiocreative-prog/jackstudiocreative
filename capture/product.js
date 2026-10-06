// Product capture: shoot a product's 360° turn, or its open / close sequence, with a phone.
// Live guides keep every photo lined up — a square frame, a "ghost" of the last photo, a level,
// a progress ring and a warning if the phone moves. The photos go straight into a Product 360° project.
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
const MOVED_DEG = 3;          // the phone has turned this far since the first photo → warn
const INK = '43, 33, 28', IVORY = '251, 248, 240', TAN = '#c38239', SAGE = '#8da68a', DANGER = '#a3341f';

const params = new URLSearchParams(location.search);
const st = {
  shoot: params.get('shoot') === 'action' ? 'action' : 'spin',   // what is being shot
  trigger: 'manual',                                             // 'manual' (tap) | 'auto' (timer)
  count: 36, turnSecs: 60, every: 3,
  stream: null, wakeLock: null, raf: 0,
  shots: [], ghost: null, showGhost: true, busy: false,
  R: null, R0: null,                                             // phone orientation now / at the first photo
  auto: { running: false, nextAt: 0, interval: 0 },
  frame: null,                                                   // the square on screen { x, y, side }
  urls: [], viewer: null, user: null, projects: [], saved: false,
};

function show(id) {
  ['intro', 'live', 'review'].forEach((s) => { $(s).hidden = s !== id; });
}

/* ---------------- Set-up screen ---------------- */

const TIPS = {
  spin: {
    manual: ['<b>Use a tripod</b> and leave the phone alone for the whole turn', '<b>Product in the middle of the turntable</b>, inside the dashed box', '<b>Turn one step, then tap</b> — the ring shows how far round you are', 'Keep the light the same for every photo'],
    auto: ['<b>Use a tripod</b> and leave the phone alone for the whole turn', '<b>Product in the middle of the turntable</b>, inside the dashed box', '<b>Start the turntable first</b>, then press Start', 'Keep the light the same for every photo'],
  },
  action: {
    manual: ['<b>Use a tripod</b> — do not move the phone or the product', '<b>First photo closed</b>, last photo fully open', '<b>Open it a little at a time</b>, hands out of the picture, then tap', 'The faint “ghost” of the last photo shows if anything has shifted'],
    auto: ['<b>Use a tripod</b> — do not move the phone or the product', '<b>First photo closed</b>, last photo fully open', '<b>Open it a little between photos</b> and take your hands away before each one', 'The faint “ghost” of the last photo shows if anything has shifted'],
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
  const spin = st.shoot === 'spin', auto = st.trigger === 'auto';
  $('f-count').hidden = !spin;
  $('f-turn').hidden = !(spin && auto);
  $('f-every').hidden = !(!spin && auto);
  $('manual-sub').textContent = spin ? 'Turntable turned by hand' : 'You decide when';
  $('auto-sub').textContent = spin ? 'Electric turntable' : 'On a timer';
  const step = 360 / st.count;
  $('plan').textContent = spin
    ? auto
      ? `${st.count} photos, one every ${(st.turnSecs / st.count).toFixed(1)} seconds while the turntable makes one full turn.`
      : `${st.count} photos. Turn the turntable ${Number.isInteger(step) ? step : step.toFixed(1)}° after each one.`
    : auto
      ? `A photo every ${st.every} seconds until you press Finish. 8–30 photos is plenty.`
      : 'Tap for each photo and press Finish when it is fully open. 8–30 photos is plenty.';
  $('tips').innerHTML = TIPS[st.shoot][st.trigger].map((t) => `<li>${t}</li>`).join('');
}

document.querySelector(`input[name="shoot"][value="${st.shoot}"]`).checked = true;
['count-sel', 'turn-secs', 'every-sel'].forEach((id) => $(id).addEventListener('input', renderSetup));
document.querySelectorAll('input[name="shoot"], input[name="trigger"]').forEach((r) => r.addEventListener('change', renderSetup));
renderSetup();

/* ---------------- Sensors (optional: a phone without them still shoots, minus the level and movement guides) ---------------- */

const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : window.orientation || 0);

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  st.R = rotationFromEuler(e.alpha, e.beta, e.gamma, screenAngle());
}
const rollDeg = () => (st.R ? Math.asin(clamp(st.R[6], -1, 1)) / DEG : null); // sideways tilt of the camera
function movedDeg() {
  if (!st.R || !st.R0) return 0;
  const M = mat.mul(mat.t(st.R0), st.R);
  return Math.acos(clamp((M[0] + M[4] + M[8] - 1) / 2, -1, 1)) / DEG;
}

/* ---------------- Start ---------------- */

async function start() {
  const err = $('intro-error');
  err.hidden = true;
  readSetup();
  try {
    if (!window.isSecureContext) throw new Error('Open this page with an https:// address — the camera only works on secure connections.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera. Please use Safari or Chrome.');

    // iOS asks for motion permission; it must happen inside this tap. Refusing only switches the level guide off.
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
    }
    window.addEventListener('deviceorientation', onOrientation);

    st.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    const video = $('video');
    video.srcObject = st.stream;
    await video.play();
    await waitFor(() => video.videoWidth > 0, 4000, 'The camera shows no picture. Please reload the page.');

    st.wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
    resetShots();
    const auto = st.trigger === 'auto';
    st.auto.interval = (st.shoot === 'spin' ? st.turnSecs / st.count : st.every) * 1000;
    $('shutter').classList.toggle('is-auto', auto);
    $('shutter').textContent = auto ? 'START' : '';
    $('shutter').setAttribute('aria-label', auto ? 'Start taking photos' : 'Take photo');
    $('of').hidden = st.shoot !== 'spin';
    $('total').textContent = st.count;
    show('live');
    layout();
    updateCount();
    loop();
  } catch (e) {
    stopCamera();
    err.textContent = e.name === 'NotAllowedError' ? 'Please allow camera access to take the photos.' : e.message;
    err.hidden = false;
  }
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
  st.shots = [];
  st.ghost = null;
  st.R0 = null;
  st.auto.running = false;
}

/* ---------------- Live view ---------------- */

/** The square that is photographed: centred, as large as fits between the top and bottom bars.
 *  The video is sized so the square shows the full short side of the camera picture — what is
 *  inside the square is exactly what is saved. */
function layout() {
  const video = $('video');
  const W = window.innerWidth, H = window.innerHeight;
  const side = Math.max(160, Math.floor(Math.min(W - 24, H - 268))); // room for the top bar, the hint and the buttons
  st.frame = { x: Math.round((W - side) / 2), y: Math.round((H - side) / 2) - 16, side };
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = side / Math.min(vw, vh);
  video.style.width = `${vw * s}px`;
  video.style.height = `${vh * s}px`;
  video.style.left = `${st.frame.x + side / 2 - (vw * s) / 2}px`;
  video.style.top = `${st.frame.y + side / 2 - (vh * s) / 2}px`;
}
window.addEventListener('resize', () => { if (!$('live').hidden) layout(); });

function loop() {
  st.raf = requestAnimationFrame(loop);
  const video = $('video');
  if (video.videoWidth && (!st.frame || video.videoWidth !== st.lastVW)) { st.lastVW = video.videoWidth; layout(); }
  draw();
  autoShoot();
  hint();
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
  ctx.fillStyle = `rgba(${INK}, 0.72)`;
  ctx.fillRect(0, 0, W, y);
  ctx.fillRect(0, y + side, W, H - y - side);
  ctx.fillRect(0, y, x, side);
  ctx.fillRect(x + side, y, W - x - side, side);

  // ghost of the last photo: the product should sit exactly on top of it
  if (st.showGhost && st.ghost) {
    ctx.globalAlpha = 0.42;
    ctx.drawImage(st.ghost, x, y, side, side);
    ctx.globalAlpha = 1;
  }

  // dashed box to keep the product inside, and the turntable's centre line
  const inset = side * 0.12;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = `rgba(${IVORY}, 0.75)`;
  ctx.strokeRect(x + inset, y + inset, side - inset * 2, side - inset * 2);
  ctx.beginPath();
  ctx.moveTo(x + side / 2, y + inset * 0.4);
  ctx.lineTo(x + side / 2, y + side - inset * 0.4);
  ctx.stroke();
  ctx.setLineDash([]);

  // the frame itself, with corner marks
  ctx.strokeStyle = `rgba(${IVORY}, 0.95)`;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, side, side);
  ctx.lineWidth = 4;
  const c = 18;
  [[x, y, 1, 1], [x + side, y, -1, 1], [x, y + side, 1, -1], [x + side, y + side, -1, -1]].forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + sx * c, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * c);
    ctx.stroke();
  });

  // level: a short bar under the top edge that tilts with the phone
  const roll = rollDeg();
  if (roll != null) {
    const level = Math.abs(roll) <= LEVEL_DEG;
    const lx = x + side / 2, ly = y + 22, half = 34;
    ctx.strokeStyle = `rgba(${IVORY}, 0.6)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx - half - 14, ly); ctx.lineTo(lx - half - 4, ly);
    ctx.moveTo(lx + half + 4, ly); ctx.lineTo(lx + half + 14, ly);
    ctx.stroke();
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(clamp(roll, -30, 30) * DEG); // stays level with the world: right side of the phone up → the bar turns clockwise
    ctx.strokeStyle = level ? SAGE : TAN;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-half, 0); ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.restore();
  }

  // 360° turn: a ring of dots, one per photo, filled as they are taken
  if (st.shoot === 'spin') {
    const r = 24, cx = x + side - r - 14, cy = y + r + 14;
    ctx.fillStyle = `rgba(${INK}, 0.55)`;
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
    const dot = st.count > 48 ? 1.3 : st.count > 36 ? 1.7 : 2.2;
    for (let i = 0; i < st.count; i++) {
      const a = (i / st.count) * Math.PI * 2 - Math.PI / 2;
      const taken = i < st.shots.length, next = i === st.shots.length;
      ctx.fillStyle = taken ? TAN : next ? `rgba(${IVORY}, 1)` : `rgba(${IVORY}, 0.4)`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, next ? dot + 1.6 : dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // automatic shooting: the Start button fills up as the next photo approaches
  if (st.trigger === 'auto') {
    const left = st.auto.running ? clamp((st.auto.nextAt - performance.now()) / st.auto.interval, 0, 1) : 1;
    $('shutter').style.setProperty('--p', String(Math.round((1 - left) * 100)));
  }
}

function hint() {
  const el = $('hint');
  let text, warn = false;
  const n = st.shots.length, spin = st.shoot === 'spin', auto = st.trigger === 'auto';
  const roll = rollDeg();
  if (n && movedDeg() > MOVED_DEG) { text = 'The phone has moved — line the product up with the ghost'; warn = true; }
  else if (!n && roll != null && Math.abs(roll) > LEVEL_DEG * 2) { text = 'Hold the phone level'; warn = true; }
  else if (auto && st.auto.running) {
    const secs = Math.max(0, (st.auto.nextAt - performance.now()) / 1000);
    text = spin ? 'Shooting — keep clear of the turntable' : secs > 1.2 ? `Open it a little — next photo in ${Math.ceil(secs)}` : 'Hands out of the picture';
  } else if (auto) text = n ? 'Paused — press Start to carry on' : spin ? 'Start the turntable, then press Start' : 'Product closed? Press Start';
  else if (!n) text = spin ? 'Line the product up inside the dashed box, then tap' : 'Product closed? Tap for the first photo';
  else if (spin) {
    const step = 360 / st.count;
    text = `Turn the turntable one step (${Number.isInteger(step) ? step : step.toFixed(1)}°), then tap`;
  } else text = 'Open it a little more, hands out, then tap';
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('is-warn', warn);
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

async function shoot() {
  if (st.busy || $('live').hidden) return;
  if (st.shoot === 'spin' ? st.shots.length >= st.count : st.shots.length >= MAX_ACTION) return;
  st.busy = true;
  try {
    const cv = grab();
    const flash = $('flash');
    flash.classList.add('is-on');
    setTimeout(() => flash.classList.remove('is-on'), 60);
    navigator.vibrate?.(20);
    const blob = await new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the photo'))), 'image/jpeg', 0.88));
    st.shots.push({ blob });
    st.ghost = cv;
    if (!st.R0 && st.R) st.R0 = st.R;
    updateCount();
    const full = st.shoot === 'spin' ? st.shots.length >= st.count : st.shots.length >= MAX_ACTION;
    if (full) finish();
  } catch (e) {
    st.auto.running = false;
    alert(e.message);
  } finally {
    st.busy = false;
  }
}

function autoShoot() {
  const a = st.auto;
  if (!a.running || st.busy) return;
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
  $('shutter').textContent = on ? 'PAUSE' : 'START';
  $('shutter').setAttribute('aria-label', on ? 'Pause' : 'Start taking photos');
}

function updateCount() {
  const n = st.shots.length;
  $('count').textContent = n;
  $('undo').disabled = !n;
  $('finish').disabled = n < (st.shoot === 'spin' ? MIN_SPIN : MIN_ACTION);
}

$('shutter').addEventListener('click', () => {
  if (st.trigger === 'auto') setAuto(!st.auto.running);
  else shoot();
});
$('undo').addEventListener('click', async () => {
  if (st.auto.running) setAuto(false);
  st.shots.pop();
  const last = st.shots[st.shots.length - 1];
  st.ghost = last ? await createImageBitmap(last.blob).catch(() => null) : null;
  if (!last) st.R0 = null;
  updateCount();
});
$('ghost').addEventListener('click', () => {
  st.showGhost = !st.showGhost;
  $('ghost').setAttribute('aria-pressed', String(st.showGhost));
});
$('cancel').addEventListener('click', () => {
  if (st.shots.length && !confirm('Discard these photos?')) return;
  stopCamera();
  resetShots();
  show('intro');
});
$('finish').addEventListener('click', () => {
  const missing = st.count - st.shots.length;
  if (st.shoot === 'spin' && missing > 0 && !confirm(`${st.shots.length} of ${st.count} photos — the turn will have a gap. Finish anyway?`)) return;
  finish();
});
$('start').addEventListener('click', start);

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
  show('review');
  st.saved = false;
  saveError('');
  setProgress(null);
  st.urls.forEach(URL.revokeObjectURL);
  st.urls = st.shots.map((s) => URL.createObjectURL(s.blob));
  st.viewer?.destroy();
  $('stage').innerHTML = '';
  const n = st.shots.length, spin = st.shoot === 'spin';
  // the same viewer customers get: a spin to drag, or the opening played from its hotspot
  st.viewer = spin
    ? new SpinViewer($('stage'), st.urls, { label: 'Your 360° photos' })
    : new SpinViewer($('stage'), [st.urls[0]], { label: 'Your open / close photos', hint: 'Press Open to play', action: { frames: st.urls, frame: 1, x: 0.5, y: 0.5, span: 99 } });
  const size = st.shots.reduce((a, s) => a + s.blob.size, 0);
  $('review-info').textContent = `${n} photos · ${(size / 1024 / 1024).toFixed(1)} MB · ${spin ? 'drag to turn it' : 'press Open to play it'}`;

  const save = $('save');
  save.disabled = false;
  save.textContent = 'Save to project';
  save.hidden = !hasToken();
  $('save-box').hidden = !hasToken();
  if (!hasToken()) {
    $('review-note').innerHTML = `Download the photos, then upload them in the Studio under ${spin ? '<b>Multi-angle photos</b>' : '<b>Open / close</b>'}. To save straight from this phone next time, <a class="pc-link" href="../studio/">sign in to the Studio</a> here first and tick “Keep me signed in”.`;
    return;
  }
  $('review-note').textContent = 'Saving keeps the photos as a draft. Nothing goes public until you publish in the Studio.';
  try { await loadProjects(); }
  catch (e) { saveError(`Could not load your projects: ${e.message}`); save.hidden = true; }
}

async function loadProjects() {
  const sel = $('project');
  sel.innerHTML = '<option value="">Loading…</option>';
  const index = await loadIndex();
  st.projects = index.projects;
  const products = index.projects.filter((p) => p.type === 'product');
  const wanted = params.get('project');
  sel.innerHTML = `<option value="">Choose a project…</option>${
    products.map((p) => `<option value="${escapeAttr(p.id)}">${escapeText(p.title)}</option>`).join('')}${
    st.shoot === 'spin' ? '<option value="__new">+ New product project…</option>' : ''}`;
  if (wanted && products.some((p) => p.id === wanted)) sel.value = wanted;
  else if (!products.length && st.shoot === 'spin') sel.value = '__new';
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
  const spin = st.shoot === 'spin';
  if (!spin && !d.spin) throw new Error('This project has no 360° photos yet. Shoot the 360° turn first, then the open / close photos.');

  const n = st.shots.length, pad = Math.max(2, String(n).length);
  const folder = `media/products/${p.id}/${spin ? 'spin' : 'action'}-${Date.now().toString(36)}`;
  const put = st.shots.map((s, i) => ({ path: `${folder}/frame-${String(i + 1).padStart(pad, '0')}.jpg`, content: s.blob }));
  const files = { folder, pattern: 'frame-{n}.jpg', count: n, pad };
  if (spin) {
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
    message: `Add ${spin ? '360° photos' : 'open / close photos'} to "${p.title}" from phone capture`,
  });
  return p;
}

$('save').addEventListener('click', async () => {
  const save = $('save');
  saveError('');
  save.disabled = true;
  save.textContent = 'Saving…';
  try {
    const p = await saveToProject();
    st.saved = true;
    save.textContent = 'Saved ✓';
    $('save-box').hidden = true;
    $('review-note').innerHTML = `Saved to “${escapeText(p.title)}” as a draft. <a class="pc-link" href="../studio/#/project/${encodeURIComponent(p.id)}">Open it in the Studio</a>${
      st.shoot === 'action' ? ' to choose the angle and place the hotspot' : ''}. If the project is open on a computer, reload that page first.`;
  } catch (e) {
    save.disabled = false;
    save.textContent = 'Save to project';
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
    saveBlob(zip, `jackstudio-${st.shoot === 'spin' ? '360' : 'open-close'}-${stamp}.zip`);
  } catch (e) {
    saveError(`Download failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download photos';
  }
});

$('again').addEventListener('click', () => {
  if (!st.saved && !confirm('Discard these photos and shoot again?')) return;
  st.viewer?.destroy();
  st.viewer = null;
  st.urls.forEach(URL.revokeObjectURL);
  st.urls = [];
  resetShots();
  show('intro');
});
