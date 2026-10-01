// Phone 360° capture: guided shooting with the gyro, then on-device stitching.
import { rotationFromEuler, mat, forward, yawPitch, dirFromYawPitch } from './stitch.js';
import { buildTargets } from './targets.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const FOV_KEY = 'js360-fov';
const ALIGN_DEG = 4;          // how close to a target before auto-shooting
const STILL_DEG_PER_S = 12;   // "holding still" threshold
const STILL_MS = 350;

const targets = buildTargets();
$('total').textContent = targets.length;

const st = {
  R: null, prevR: null, prevT: 0, speed: 999, stillSince: 0,
  yaw0: 0, stream: null, wakeLock: null, raf: 0,
  shots: [], busy: false, capW: 0, capH: 0,
  fov: readFov(),
};

function readFov() {
  try { const v = Number(localStorage.getItem(FOV_KEY)); return v > 30 && v < 100 ? v : null; } catch { return null; }
}
function saveFov(v) { try { localStorage.setItem(FOV_KEY, v.toFixed(2)); } catch {} }

function show(id) {
  ['intro', 'live', 'proc', 'result'].forEach((s) => { $(s).hidden = s !== id; });
}

/* ---------------- Sensors ---------------- */

const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : window.orientation || 0);

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const now = performance.now();
  const R = rotationFromEuler(e.alpha, e.beta, e.gamma, screenAngle());
  if (st.prevR) {
    const M = mat.mul(mat.t(st.prevR), R);
    const ang = Math.acos(Math.max(-1, Math.min(1, (M[0] + M[4] + M[8] - 1) / 2))) / DEG;
    const dt = Math.max(1, now - st.prevT) / 1000;
    st.speed = st.speed * 0.6 + (ang / dt) * 0.4; // smoothed angular speed, °/s
  }
  if (st.speed < STILL_DEG_PER_S) { if (!st.stillSince) st.stillSince = now; } else st.stillSince = 0;
  st.prevR = R; st.prevT = now; st.R = R;
}

/* ---------------- Start ---------------- */

async function start() {
  const err = $('intro-error');
  err.hidden = true;
  try {
    if (!window.isSecureContext) throw new Error('请用 https 网址打开这个页面（相机和陀螺仪只能在安全连接下使用）。');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('这个浏览器不能使用相机，请用 Safari 或 Chrome。');
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('这台手机不支持拼接所需的 WebGL2，请更新浏览器。');

    // iOS asks for motion permission; it must happen inside this tap
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') throw new Error('需要允许「动作与方向」权限才能拍 360°。');
    }
    window.addEventListener('deviceorientation', onOrientation);

    st.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    const video = $('video');
    video.srcObject = st.stream;
    await video.play();
    await waitFor(() => video.videoWidth > 0, 4000, '相机没有画面，请重新打开页面。');
    await waitFor(() => st.R, 3000, '读不到陀螺仪。请确认手机有陀螺仪，并允许「动作与方向」权限。');

    st.wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
    st.shots = [];
    st.capW = st.capH = 0;
    st.yaw0 = yawPitch(forward(st.R))[0]; // first target = straight ahead
    if (!st.fov) st.fov = 62;
    show('live');
    updateCount();
    loop();
  } catch (e) {
    stopCamera();
    err.textContent = e.name === 'NotAllowedError' ? '需要允许相机权限才能拍 360°。' : e.message;
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
  window.removeEventListener('deviceorientation', onOrientation);
  st.stream?.getTracks().forEach((t) => t.stop());
  st.stream = null;
  st.wakeLock?.release?.().catch(() => {});
  st.wakeLock = null;
}

/* ---------------- Live view ---------------- */

const targetDir = (t) => dirFromYawPitch(st.yaw0 + t.yaw * DEG, t.pitch * DEG);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;
const done = (t) => st.shots.some((s) => s.target === t.id);
const nextTarget = () => targets.find((t) => !done(t));

function loop() {
  st.raf = requestAnimationFrame(loop);
  draw();
  autoShoot();
}

function draw() {
  const cv = $('overlay'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!st.R) return;

  // focal length of the displayed (object-fit: cover) video, in CSS pixels.
  // FOV is measured along the image height, the same convention the stitcher uses.
  const v = $('video'), vw = v.videoWidth || W, vh = v.videoHeight || H;
  const scale = Math.max(W / vw, H / vh);
  const fs = ((vh / 2) / Math.tan((st.fov * DEG) / 2)) * scale;
  const Rt = mat.t(st.R);
  const next = nextTarget();

  for (const t of targets) {
    const c = mat.apply(Rt, targetDir(t));
    if (c[2] > -0.05) continue;
    const x = W / 2 + (fs * c[0]) / -c[2], y = H / 2 - (fs * c[1]) / -c[2];
    if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    ctx.beginPath();
    if (done(t)) {
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(141, 166, 138, 0.9)';
      ctx.fill();
    } else {
      const isNext = t === next;
      ctx.arc(x, y, isNext ? 20 : 12, 0, Math.PI * 2);
      ctx.fillStyle = isNext ? 'rgba(195, 130, 57, 0.95)' : 'rgba(251, 248, 240, 0.35)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(43, 33, 28, 0.6)';
      ctx.stroke();
    }
  }

  // arrow towards the next target when it is off screen
  const hint = $('hint');
  hint.classList.remove('is-warn');
  const [, pitch] = yawPitch(forward(st.R));
  const roll = Math.asin(Math.max(-1, Math.min(1, st.R[6]))) / DEG; // camera x-axis tilt
  if (Math.abs(pitch / DEG) < 70 && Math.abs(roll) > 25) {
    hint.textContent = '请竖着拿手机';
    hint.classList.add('is-warn');
    return;
  }
  if (!next) { hint.textContent = '全部拍好了'; return; }
  const c = mat.apply(Rt, targetDir(next));
  const sx = (fs * c[0]) / Math.max(1e-3, -c[2]), sy = -(fs * c[1]) / Math.max(1e-3, -c[2]);
  const onScreen = c[2] < 0 && Math.abs(sx) < W / 2 - 20 && Math.abs(sy) < H / 2 - 20;
  if (!onScreen) {
    let dx = c[0], dy = -c[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    drawArrow(ctx, W / 2 + dx * 70, H / 2 + dy * 70, Math.atan2(dy, dx));
    hint.textContent = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '向右转' : '向左转') : (dy > 0 ? '向下转' : '向上转');
  } else if (angle(forward(st.R), targetDir(next)) < ALIGN_DEG) {
    hint.textContent = '保持不动…';
  } else if (angle(forward(st.R), targetDir(next)) < ALIGN_DEG * 3) {
    hint.textContent = '再对准一点';
  } else {
    hint.textContent = '把中间的圆圈对准圆点';
  }
}

function drawArrow(ctx, x, y, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(18, 0); ctx.lineTo(-10, -14); ctx.lineTo(-4, 0); ctx.lineTo(-10, 14); ctx.closePath();
  ctx.fillStyle = 'rgba(195, 130, 57, 0.95)';
  ctx.fill();
  ctx.restore();
}

function autoShoot() {
  if (st.busy || !st.R || !st.stillSince || performance.now() - st.stillSince < STILL_MS) return;
  const f = forward(st.R);
  const t = targets.find((x) => !done(x) && angle(f, targetDir(x)) < ALIGN_DEG);
  if (t) shoot(t);
}

async function shoot(t) {
  if (st.busy) return;
  st.busy = true;
  try {
    const v = $('video');
    if (!st.capW) {
      const s = 960 / Math.max(v.videoWidth, v.videoHeight);
      st.capW = Math.round(v.videoWidth * s);
      st.capH = Math.round(v.videoHeight * s);
    }
    const R = st.R.slice();
    const cv = document.createElement('canvas');
    cv.width = st.capW; cv.height = st.capH;
    cv.getContext('2d').drawImage(v, 0, 0, st.capW, st.capH);
    const flash = $('flash');
    flash.classList.add('is-on');
    requestAnimationFrame(() => flash.classList.remove('is-on'));
    navigator.vibrate?.(30);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    st.shots.push({ blob, R, target: t.id });
    updateCount();
    if (!nextTarget()) finish();
  } finally {
    st.stillSince = 0;
    st.busy = false;
  }
}

function updateCount() {
  $('count').textContent = st.shots.length;
  $('undo').disabled = !st.shots.length;
  $('finish').disabled = st.shots.length < 6;
}

$('shutter').addEventListener('click', () => {
  if (!st.R) return;
  const f = forward(st.R);
  const near = targets.filter((x) => !done(x)).sort((a, b) => angle(f, targetDir(a)) - angle(f, targetDir(b)))[0];
  if (near && angle(f, targetDir(near)) < 15) shoot(near);
  else { $('hint').textContent = '请对准圆点附近再拍'; }
});
$('undo').addEventListener('click', () => { st.shots.pop(); updateCount(); });
$('cancel').addEventListener('click', () => {
  if (st.shots.length && !confirm('确定放弃这次拍摄？')) return;
  stopCamera();
  show('intro');
});
$('finish').addEventListener('click', () => {
  const missing = targets.length - st.shots.length;
  if (missing > 0 && !confirm(`还有 ${missing} 个位置没拍，没拍到的地方会自动补上模糊背景。要现在完成吗？`)) return;
  finish();
});
$('start').addEventListener('click', start);

/* ---------------- Stitch ---------------- */

const STAGES = { prepare: ['准备照片…', 0, 0.05], align: ['对齐照片…', 0.05, 0.75], render: ['合成全景图…', 0.75, 0.95], finish: ['完成中…', 0.95, 1] };

function setProgress(stage, p) {
  const [label, a, b] = STAGES[stage] || ['处理中…', 0, 1];
  $('proc-stage').textContent = label;
  $('proc-bar').style.width = `${Math.round((a + (b - a) * p) * 100)}%`;
}

async function finish() {
  stopCamera();
  show('proc');
  setProgress('prepare', 0);
  const shots = st.shots.map((s) => ({ blob: s.blob, R: s.R }));
  const calibrated = readFov();
  const opts = { fovDeg: st.fov, fovRange: calibrated ? 6 : 14, width: 4096 };
  try {
    const res = await stitchInWorker(shots, opts).catch(async (err) => {
      console.warn('Worker stitching failed, using main thread:', err);
      const { stitchPanorama } = await import('./stitch.js');
      return stitchPanorama(shots, { ...opts, onProgress: setProgress });
    });
    saveFov(res.fovDeg);
    st.fov = res.fovDeg;
    showResult(res);
  } catch (err) {
    alert(`拼接失败：${err.message}`);
    show('intro');
  }
}

function stitchInWorker(shots, opts) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL('./stitch-worker.js', import.meta.url), { type: 'module' }); }
    catch (e) { reject(e); return; }
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') setProgress(data.stage, data.p);
      else if (data.type === 'done') { worker.terminate(); resolve(data); }
      else if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker error')); };
    worker.postMessage({ shots, opts });
  });
}

let viewer = null;
let resultUrl = null;

async function showResult(res) {
  show('result');
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(res.blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `jackstudio-360-${stamp}.jpg`;
  $('download').href = resultUrl;
  $('download').download = name;
  $('result-info').textContent = `${res.width}×${res.height} · ${(res.blob.size / 1024 / 1024).toFixed(1)} MB · ${st.shots.length} 张照片`;

  const file = new File([res.blob], name, { type: 'image/jpeg' });
  const share = $('share');
  share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  share.onclick = () => navigator.share({ files: [file], title: 'Jack Studio 360°' }).catch(() => {});

  const { Viewer } = await import('@photo-sphere-viewer/core');
  viewer?.destroy();
  viewer = new Viewer({ container: $('cap-pano'), panorama: resultUrl, navbar: ['zoom', 'fullscreen'] });
}

$('again').addEventListener('click', () => {
  viewer?.destroy();
  viewer = null;
  show('intro');
});

// test hook (used by automated tests only)
window.__js360 = { st, targets };
