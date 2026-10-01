// Jack Studio 360 — phone panorama stitcher (no dependencies)
//
// Input:  photos taken with the phone + the phone's orientation (gyro) for each photo.
// Output: a 2:1 equirectangular JPG ready for the Showroom viewer.
//
// Pipeline: gyro placement → image-based alignment refinement (rotation + focal length)
//           → exposure gain compensation → WebGL2 blending → hole filling → JPG.
//
// Coordinate frames
//   World:  X east, Y north, Z up (W3C DeviceOrientation earth frame)
//   Camera: x right, y up (screen), z towards the viewer — the back camera looks along -z
//   R (row-major 3x3) maps camera → world.

/* ------------------------------------------------------------------ */
/* Small matrix helpers                                                */
/* ------------------------------------------------------------------ */

export const mat = {
  mul(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return o;
  },
  t(a) { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; },
  apply(a, v) {
    return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
  },
  rx(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  ry(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
  rz(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  // rotation vector (axis * angle) → matrix (Rodrigues)
  exp(x, y, z) {
    const th = Math.hypot(x, y, z);
    if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const kx = x / th, ky = y / th, kz = z / th, c = Math.cos(th), s = Math.sin(th), v = 1 - c;
    return [
      c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s,
      ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s,
      kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v,
    ];
  },
};

const DEG = Math.PI / 180;

/** DeviceOrientation (alpha, beta, gamma in degrees) + screen angle → camera→world matrix. */
export function rotationFromEuler(alpha, beta, gamma, screenAngle = 0) {
  const r = mat.mul(mat.mul(mat.rz(alpha * DEG), mat.rx(beta * DEG)), mat.ry(gamma * DEG));
  return screenAngle ? mat.mul(r, mat.rz(-screenAngle * DEG)) : r;
}

/** Camera viewing direction (world) of a rotation. */
export const forward = (R) => [-R[2], -R[5], -R[8]];

/** yaw (east of north) / pitch of a world direction, radians. */
export function yawPitch(d) {
  return [Math.atan2(d[0], d[1]), Math.asin(Math.max(-1, Math.min(1, d[2])))];
}

export function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [cp * Math.sin(yaw), cp * Math.cos(yaw), Math.sin(pitch)];
}

/** Rotation that looks at (yaw, pitch) with no roll — used for capture targets. */
export function lookRotation(yaw, pitch) {
  // start upright facing north: Rx(90°); pitch up = extra rotation about x; yaw = rotation about world z (negative = to the right)
  return mat.mul(mat.rz(-yaw), mat.rx(Math.PI / 2 + pitch));
}

/* ------------------------------------------------------------------ */
/* Image preparation                                                   */
/* ------------------------------------------------------------------ */

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Grayscale float image (0..1), box-blurred, at a given width. */
function grayLevel(bitmap, width, blur) {
  const height = Math.round((bitmap.height / bitmap.width) * width);
  const cv = makeCanvas(width, height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  let g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
  for (let k = 0; k < blur; k++) g = boxBlur(g, width, height);
  return { g, w: width, h: height };
}

function boxBlur(src, w, h) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    tmp[i] = (src[i - (x > 0 ? 1 : 0)] + src[i] + src[i + (x < w - 1 ? 1 : 0)]) / 3;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = (tmp[i - (y > 0 ? w : 0)] + tmp[i] + tmp[i + (y < h - 1 ? w : 0)]) / 3;
  }
  return out;
}

function sampleGray(img, x, y) {
  // bilinear, x/y in pixels; caller guarantees in-bounds
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, w = img.w, g = img.g, i = y0 * w + x0;
  const a = g[i], b = g[i + 1], c = g[i + w], d = g[i + w + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/* ------------------------------------------------------------------ */
/* Alignment refinement                                                */
/* ------------------------------------------------------------------ */

const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/** Rotation matrix → rotation vector (axis * angle). */
function logRot(M) {
  const th = Math.acos(Math.max(-1, Math.min(1, (M[0] + M[4] + M[8] - 1) / 2)));
  if (th < 1e-9) return [0, 0, 0];
  const k = th / (2 * Math.sin(th));
  return [(M[7] - M[5]) * k, (M[2] - M[6]) * k, (M[3] - M[1]) * k];
}

/**
 * Refines each shot's rotation (and the shared focal length) so neighbouring photos line up.
 *  A. measure the misalignment of every overlapping pair (image correlation, coarse → fine)
 *  B. solve all corrections at once (least squares) — removes gyro drift around the rings
 *  C. polish everything together, including the focal length
 * Works on small blurred grayscale copies; pair cost = 1 - NCC.
 */
function refineAlignment(shots, nLevels, fovDeg, onProgress, opts = {}) {
  const n = shots.length;
  const orig = shots.map((s) => s.R);          // gyro rotations — reference for the tilt prior
  const base = orig.slice();                    // current best rotations
  const params = shots.map(() => [0, 0, 0]);    // polish-stage corrections (world frame)
  let fov = fovDeg;
  // The phone's tilt (from gravity) is reliable, so tilt corrections are gently penalised;
  // yaw drifts on every phone, so yaw corrections are free.
  const priorW = 0.15;
  const tiltLambda = 0.05; // per deg², used by the global solve

  const rotOf = (i) => mat.mul(mat.exp(params[i][0], params[i][1], params[i][2]), base[i]);

  const fwd = orig.map(forward);
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (angleBetween(fwd[i], fwd[j]) < fovDeg * 0.95 * DEG) pairs.push([i, j]);
  }
  const pairsOf = Array.from({ length: n }, () => []);
  pairs.forEach((p, k) => { pairsOf[p[0]].push(k); pairsOf[p[1]].push(k); });

  let level = 0, samples = null, R = shots.map((_, i) => rotOf(i));

  function buildSamples() {
    // sample grid per image: camera rays + intensity at those pixels
    samples = shots.map((s) => {
      const img = s.levels[level];
      const f = (img.h / 2) / Math.tan((fov * DEG) / 2);
      const cols = level === 0 ? 14 : 20, rows = Math.round(cols * img.h / img.w);
      const pts = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = (0.06 + 0.88 * (c + 0.5) / cols) * (img.w - 1);
        const y = (0.06 + 0.88 * (r + 0.5) / rows) * (img.h - 1);
        const v = [(x - img.w / 2) / f, -(y - img.h / 2) / f, -1];
        const len = Math.hypot(v[0], v[1], v[2]);
        pts.push({ ray: [v[0] / len, v[1] / len, v[2] / len], val: sampleGray(img, x, y) });
      }
      return { pts, f };
    });
  }

  function project(j, d) {
    const Rt = R[j];
    const cx = Rt[0] * d[0] + Rt[3] * d[1] + Rt[6] * d[2];
    const cy = Rt[1] * d[0] + Rt[4] * d[1] + Rt[7] * d[2];
    const cz = Rt[2] * d[0] + Rt[5] * d[1] + Rt[8] * d[2];
    if (cz > -1e-3) return null;
    const img = shots[j].levels[level], f = samples[j].f;
    const x = img.w / 2 + (f * cx) / -cz, y = img.h / 2 - (f * cy) / -cz;
    if (x < 1 || y < 1 || x > img.w - 2 || y > img.h - 2) return null;
    return [x, y];
  }

  // returns [cost, count, meanI, meanJ, ncc]
  function pairStats(i, j) {
    let n0 = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    const acc = (from, to) => {
      const Rf = R[from], img = shots[to].levels[level];
      for (const p of samples[from].pts) {
        const xy = project(to, mat.apply(Rf, p.ray));
        if (!xy) continue;
        const other = sampleGray(img, xy[0], xy[1]);
        const a = from === i ? p.val : other, b = from === i ? other : p.val;
        n0++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
      }
    };
    acc(i, j); acc(j, i);
    if (n0 < 24) return [0, 0, 0, 0, 0];
    const va = saa / n0 - (sa / n0) ** 2, vb = sbb / n0 - (sb / n0) ** 2;
    const ncc = (sab / n0 - (sa / n0) * (sb / n0)) / Math.sqrt(Math.max(va * vb, 1e-10));
    return [(1 - ncc) * Math.min(1, n0 / 120), n0, sa / n0, sb / n0, ncc];
  }

  const prior = (i) => {
    const c = logRot(mat.mul(rotOf(i), mat.t(orig[i])));
    return priorW * (c[0] ** 2 + c[1] ** 2) / (DEG * DEG * 25);
  };

  function allCosts() {
    R = shots.map((_, i) => rotOf(i));
    let total = 0;
    for (const [i, j] of pairs) total += pairStats(i, j)[0];
    for (let i = 0; i < n; i++) total += prior(i);
    return total;
  }

  function localCost(i) {
    R[i] = rotOf(i);
    let c = prior(i);
    for (const k of pairsOf[i]) c += pairStats(pairs[k][0], pairs[k][1])[0];
    return c;
  }

  /* --- A: pairwise misalignment ---------------------------------------- */
  function measurePairs(schedule) {
    R = shots.map((_, i) => rotOf(i));
    const est = pairs.map(() => ({ e: [0, 0, 0], n: 0, ncc: 0 }));
    for (const stage of schedule) {
      level = stage.level;
      buildSamples();
      pairs.forEach(([i, j], k) => {
        const Rj0 = R[j], e = est[k].e;
        const cost = () => { R[j] = mat.mul(mat.exp(e[0], e[1], e[2]), Rj0); return pairStats(i, j)[0]; };
        if (stage.grid) {
          // wide search first: gyro yaw can be several degrees off, tilt less so
          const right = [Rj0[0], Rj0[3], Rj0[6]];
          e[0] = e[1] = e[2] = 0;
          const gyroCost = cost();
          let best = Infinity, bestE = [0, 0, 0];
          for (let ya = -stage.grid.yaw; ya <= stage.grid.yaw + 1e-9; ya += stage.grid.step) {
            for (let pa = -stage.grid.pitch; pa <= stage.grid.pitch + 1e-9; pa += stage.grid.step) {
              e[0] = right[0] * pa * DEG; e[1] = right[1] * pa * DEG; e[2] = ya * DEG + right[2] * pa * DEG;
              const c = cost();
              if (c < best) { best = c; bestE = e.slice(); }
            }
          }
          // only trust the wide search when it is clearly better than the gyro
          if (best < gyroCost - 0.02) { e[0] = bestE[0]; e[1] = bestE[1]; e[2] = bestE[2]; }
          else { e[0] = e[1] = e[2] = 0; }
        }
        for (const stepDeg of stage.steps) {
          const step = stepDeg * DEG;
          let cur = cost();
          for (let iter = 0; iter < 8; iter++) {
            let moved = false;
            for (let a = 0; a < 3; a++) {
              const o = e[a];
              let best = cur, bv = o;
              for (const dv of [step, -step]) { e[a] = o + dv; const c = cost(); if (c < best - 1e-7) { best = c; bv = o + dv; } }
              e[a] = bv; cur = best;
              if (bv !== o) moved = true;
            }
            if (!moved) break;
          }
        }
        cost();
        const st = pairStats(i, j);
        est[k].n = st[1]; est[k].ncc = st[4];
        R[j] = Rj0;
      });
    }
    return est;
  }

  /* --- B: global least-squares solve ---------------------------------- */
  function solveGlobal(est) {
    const cur = shots.map((_, i) => logRot(mat.mul(rotOf(i), mat.t(orig[i]))).map((v) => v / DEG));
    const links = pairs.map(([i, j], k) => {
      const q = est[k].n >= 60 && est[k].ncc > 0.3 ? est[k].ncc ** 2 * Math.min(1, est[k].n / 300) : 0;
      return { i, j, e: est[k].e.map((v) => v / DEG), w: q, w0: q };
    }).filter((l) => l.w > 0);
    const d = shots.map(() => [0, 0, 0]);
    const linksOf = Array.from({ length: n }, () => []);
    links.forEach((l) => { linksOf[l.i].push(l); linksOf[l.j].push(l); });
    for (let round = 0; round < 4; round++) {
      for (let sweep = 0; sweep < 400; sweep++) {
        for (let i = 1; i < n; i++) {
          for (let a = 0; a < 3; a++) {
            let num = 0, den = 0;
            for (const l of linksOf[i]) {
              if (l.i === i) { num += l.w * (d[l.j][a] - l.e[a]); den += l.w; }
              else { num += l.w * (d[l.i][a] + l.e[a]); den += l.w; }
            }
            if (a < 2) { num += tiltLambda * -cur[i][a]; den += tiltLambda; }
            if (den > 0) d[i][a] = num / den;
          }
        }
      }
      // robust re-weighting: distrust pairs that disagree with the consensus
      for (const l of links) {
        const r = Math.hypot(...[0, 1, 2].map((a) => d[l.j][a] - d[l.i][a] - l.e[a]));
        l.w = l.w0 * Math.min(1, 0.4 / Math.max(r, 1e-6));
      }
    }
    if (opts.debug) console.warn('solve', 'links', links.length, 'est', est.length, 'mean|d|', (d.reduce((a, v) => a + Math.hypot(...v), 0) / n).toFixed(2), 'nccs', est.slice(0, 5).map((x) => x.ncc.toFixed(2) + '/' + x.n).join(' '));
    for (let i = 1; i < n; i++) {
      base[i] = mat.mul(mat.exp(d[i][0] * DEG, d[i][1] * DEG, d[i][2] * DEG), rotOf(i));
      params[i] = [0, 0, 0];
    }
    return links.length;
  }

  /* --- C: joint polish (rotations + focal length) ---------------------- */
  function polish(schedule, withFocal) {
    for (const stage of schedule) {
      level = stage.level;
      for (const stepDeg of stage.steps) {
        buildSamples();
        allCosts();
        const step = stepDeg * DEG;
        for (let iter = 0; iter < 8; iter++) {
          let improved = false;
          for (let i = 1; i < n; i++) { // shot 0 anchors the panorama
            for (let a = 0; a < 3; a++) {
              const o = params[i][a];
              let best = localCost(i), bv = o;
              for (const dv of [step, -step]) { params[i][a] = o + dv; const c = localCost(i); if (c < best - 1e-6) { best = c; bv = o + dv; } }
              params[i][a] = bv;
              R[i] = rotOf(i);
              if (bv !== o) improved = true;
            }
          }
          if (withFocal) {
            let bestFov = fov, bestCost = allCosts();
            for (const m of [1 + stepDeg / 60, 1 - stepDeg / 60]) {
              fov = bestFov * m;
              buildSamples();
              const c = allCosts();
              if (c < bestCost - 1e-6) { bestCost = c; bestFov = fov; improved = true; }
            }
            fov = Math.min(100, Math.max(30, bestFov));
            buildSamples();
            allCosts();
          }
          if (!improved) break;
        }
      }
    }
  }

  const L = (k) => k < nLevels;
  const progress = (p) => onProgress?.(p);

  // Mean pair disagreement — independent of how many pairs overlap at a given focal length
  function score() {
    R = shots.map((_, i) => rotOf(i));
    let c = 0, w = 0;
    for (const [i, j] of pairs) {
      const st = pairStats(i, j);
      if (!st[1]) continue;
      const wt = Math.min(1, st[1] / 120);
      c += (1 - st[4]) * wt; w += wt;
    }
    return w ? c / w : Infinity;
  }

  // Focal length sweep: quick align at each candidate, keep the one where the mosaic agrees best
  const scored = new Map();
  const tryFov = (f) => {
    const key = f.toFixed(2);
    if (!scored.has(key)) {
      fov = f;
      for (let i = 0; i < n; i++) { base[i] = orig[i]; params[i] = [0, 0, 0]; }
      solveGlobal(measurePairs([{ level: 0, grid: { yaw: 12, pitch: 4.5, step: 3 }, steps: [1.5] }]));
      level = Math.min(1, nLevels - 1);
      buildSamples();
      scored.set(key, score());
    }
    return scored.get(key);
  };
  const range = opts.fovRange ?? 14;
  const coarse = [];
  for (let f = fovDeg - range; f <= fovDeg + range + 1e-9; f += 3.5) coarse.push(f);
  let bestF = fovDeg, bestS = Infinity;
  coarse.forEach((f, k) => { const sc = tryFov(f); if (sc < bestS) { bestS = sc; bestF = f; } progress(0.25 * (k + 1) / coarse.length); });
  for (const d of [-1.75, 1.75, -0.9, 0.9]) {
    const f = bestF + d, sc = tryFov(f);
    if (sc < bestS) { bestS = sc; bestF = f; }
  }
  fov = Math.min(100, Math.max(30, bestF));
  for (let i = 0; i < n; i++) { base[i] = orig[i]; params[i] = [0, 0, 0]; }
  progress(0.3);
  const stage = (name) => opts.onStage?.(name, shots.map((_, i) => rotOf(i)), fov);
  stage('sweep');

  // 1st pass at the guessed focal length
  let links = solveGlobal(measurePairs([
    { level: 1, grid: { yaw: 12, pitch: 4.5, step: 1.5 }, steps: [0.75, 0.35] },
  ].filter((s) => L(s.level))));
  progress(0.5);
  stage('pass1');
  polish([{ level: 1, steps: [0.3] }, { level: 2, steps: [0.15] }].filter((s) => L(s.level)), true);
  progress(0.65);
  stage('polish1');
  // 2nd pass with the refined focal length removes what drift is left
  links = solveGlobal(measurePairs([{ level: 1, steps: [0.5, 0.25] }, { level: 2, steps: [0.12] }].filter((s) => L(s.level))));
  progress(0.85);
  stage('pass2');
  polish([{ level: 2, steps: [0.1, 0.05] }, { level: 3, steps: [0.03] }].filter((s) => L(s.level)), true);
  stage('polish2');
  // extra passes only while they still help (heavy gyro drift needs them, normal captures don't)
  level = Math.min(2, nLevels - 1); buildSamples();
  let sc = score();
  for (let extra = 0; extra < 2; extra++) {
    const keep = { base: base.slice(), params: params.map((p) => p.slice()), fov };
    links = solveGlobal(measurePairs([{ level: 2, steps: [0.15, 0.07] }].filter((s) => L(s.level))));
    polish([{ level: 3, steps: [0.03] }].filter((s) => L(s.level)), true);
    level = Math.min(2, nLevels - 1); buildSamples();
    const next = score();
    if (next > sc - 0.002) { // no real gain: keep the previous result and stop
      for (let i = 0; i < n; i++) { base[i] = keep.base[i]; params[i] = keep.params[i]; }
      fov = keep.fov;
      break;
    }
    sc = next;
    stage(`extra${extra + 1}`);
  }
  progress(1);

  R = shots.map((_, i) => rotOf(i));
  level = Math.min(2, nLevels - 1);
  buildSamples();
  const overlaps = pairs.map(([i, j]) => { const st = pairStats(i, j); return { i, j, n: st[1], mi: st[2], mj: st[3] }; }).filter((o) => o.n > 0);
  const finalCost = allCosts();
  return { rotations: R, fov, overlaps, cost: finalCost, pairs: pairs.length, links };
}

/** Exposure gains (Brown & Lowe style), solved with Gauss-Seidel. */
function solveGains(n, overlaps) {
  const sigmaN = 0.1, sigmaG = 0.1;
  const g = new Float64Array(n).fill(1);
  for (let it = 0; it < 200; it++) {
    for (let i = 0; i < n; i++) {
      let num = 1 / (sigmaG * sigmaG), den = 1 / (sigmaG * sigmaG);
      for (const o of overlaps) {
        if (o.i !== i && o.j !== i) continue;
        const mi = o.i === i ? o.mi : o.mj, mj = o.i === i ? o.mj : o.mi, j = o.i === i ? o.j : o.i;
        const w = Math.min(o.n, 200) / 200 / (sigmaN * sigmaN);
        num += w * mi * g[j] * mj;
        den += w * mi * mi;
      }
      g[i] = num / den;
    }
  }
  return Array.from(g, (v) => Math.min(1.6, Math.max(0.6, v)));
}

/* ------------------------------------------------------------------ */
/* WebGL2 rendering                                                    */
/* ------------------------------------------------------------------ */

const MAX_SHOTS = 48;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uImages;
uniform mat3 uRT[${MAX_SHOTS}];
uniform float uGain[${MAX_SHOTS}];
uniform int uCount;
uniform vec2 uFocal;     // focal / size, x and y (normalized image coords)
uniform vec4 uTile;      // x offset, y offset, full width, full height (pixels)
out vec4 outColor;
const float PI = 3.141592653589793;
void main() {
  vec2 p = vec2(uTile.x + gl_FragCoord.x, uTile.y + gl_FragCoord.y);
  float yaw = (p.x / uTile.z - 0.5) * 2.0 * PI;
  float pitch = (0.5 - p.y / uTile.w) * PI;    // row 0 = top
  vec3 d = vec3(cos(pitch) * sin(yaw), cos(pitch) * cos(yaw), sin(pitch));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float cover = 0.0;
  for (int i = 0; i < ${MAX_SHOTS}; i++) {
    if (i >= uCount) break;
    vec3 c = uRT[i] * d;
    if (c.z > -1e-3) continue;
    float u = 0.5 + uFocal.x * c.x / -c.z;
    float v = 0.5 - uFocal.y * c.y / -c.z;
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) continue;
    float wu = 1.0 - abs(2.0 * u - 1.0);
    float wv = 1.0 - abs(2.0 * v - 1.0);
    float w = pow(wu * wv, 3.0);
    cover = max(cover, wu * wv);
    acc += texture(uImages, vec3(u, v, float(i))).rgb * uGain[i] * w;
    wsum += w;
  }
  if (wsum <= 0.0) { outColor = vec4(0.0); return; }
  // alpha = real coverage (fades only in the last ~1% at a photo's edge), not blend weight
  outColor = vec4(clamp(acc / wsum, 0.0, 1.0), clamp(cover / 0.02, 0.0, 1.0));
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

async function renderEquirect(bitmaps, rotations, gains, fovDeg, width, onProgress) {
  const height = width / 2;
  const canvas = makeCanvas(1, 1);
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('This phone does not support WebGL2, which is needed to stitch.');

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // all photos in one texture array
  const iw = bitmaps[0].width, ih = bitmaps[0].height;
  if (bitmaps.some((b) => b.width !== iw || b.height !== ih)) throw new Error('All photos must have the same size');
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, iw, ih, bitmaps.length);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  bitmaps.forEach((b, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, iw, ih, 1, gl.RGBA, gl.UNSIGNED_BYTE, b));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // uniforms
  const rt = new Float32Array(MAX_SHOTS * 9);
  rotations.forEach((R, i) => rt.set(R, i * 9));
  gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uRT'), false, rt);
  const g = new Float32Array(MAX_SHOTS); g.set(gains);
  gl.uniform1fv(gl.getUniformLocation(prog, 'uGain'), g);
  gl.uniform1i(gl.getUniformLocation(prog, 'uCount'), bitmaps.length);
  const fy = (0.5) / Math.tan((fovDeg * DEG) / 2);  // focal in units of image height
  gl.uniform2f(gl.getUniformLocation(prog, 'uFocal'), fy * ih / iw, fy);
  gl.uniform1i(gl.getUniformLocation(prog, 'uImages'), 0);
  const tileLoc = gl.getUniformLocation(prog, 'uTile');

  // render in tiles to keep each GPU job short
  const tileW = Math.min(1024, width), tileH = Math.min(512, height);
  canvas.width = tileW; canvas.height = tileH;
  gl.viewport(0, 0, tileW, tileH);
  const out = new Uint8ClampedArray(width * height * 4);
  const px = new Uint8Array(tileW * tileH * 4);
  const tiles = (width / tileW) * (height / tileH);
  let done = 0;
  for (let ty = 0; ty < height; ty += tileH) {
    for (let tx = 0; tx < width; tx += tileW) {
      // gl_FragCoord.y and readPixels both count rows from the bottom of the tile, so treating that
      // row index as "row from the top" in the shader and when copying keeps the image upright
      gl.uniform4f(tileLoc, tx, ty, width, height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.readPixels(0, 0, tileW, tileH, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let y = 0; y < tileH; y++) {
        out.set(px.subarray(y * tileW * 4, (y + 1) * tileW * 4), ((ty + y) * width + tx) * 4);
      }
      onProgress?.(++done / tiles);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { data: out, width, height };
}

/* ------------------------------------------------------------------ */
/* Hole filling (top / bottom / missed spots): push-pull pyramid        */
/* ------------------------------------------------------------------ */

function fillHoles(img) {
  const { data, width, height } = img;
  // build pyramid of premultiplied colour + weight at 1/4 resolution and below
  const levels = [];
  let w = width >> 2, h = height >> 2;
  let cur = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const p = ((y * 4 + dy) * width + x * 4 + dx) * 4, al = data[p + 3] / 255;
      r += data[p] * al; g += data[p + 1] * al; b += data[p + 2] * al; a += al;
    }
    const q = (y * w + x) * 4;
    cur[q] = r / 16; cur[q + 1] = g / 16; cur[q + 2] = b / 16; cur[q + 3] = a / 16;
  }
  levels.push({ d: cur, w, h });
  while (w > 2 && h > 1) {
    const nw = w >> 1, nh = Math.max(1, h >> 1), next = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const q = (y * nw + x) * 4;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const p = ((Math.min(h - 1, y * 2 + dy)) * w + x * 2 + dx) * 4;
        for (let k = 0; k < 4; k++) next[q + k] += cur[p + k] / 4;
      }
    }
    levels.push({ d: next, w: nw, h: nh });
    cur = next; w = nw; h = nh;
  }
  // pull: fill each level's weak pixels from the coarser one (wrapping horizontally)
  for (let L = levels.length - 2; L >= 0; L--) {
    const fine = levels[L], coarse = levels[L + 1];
    for (let y = 0; y < fine.h; y++) for (let x = 0; x < fine.w; x++) {
      const q = (y * fine.w + x) * 4, a = fine.d[q + 3];
      if (a >= 0.999) continue;
      const gx = (x + 0.5) / 2 - 0.5, gy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(gx), y0 = Math.floor(gy), ax = gx - x0, ay = gy - y0, y1 = Math.min(coarse.h - 1, y0 + 1);
      const xa = ((x0 % coarse.w) + coarse.w) % coarse.w, xb = (xa + 1) % coarse.w;
      const corners = [[xa, y0, (1 - ax) * (1 - ay)], [xb, y0, ax * (1 - ay)], [xa, y1, (1 - ax) * ay], [xb, y1, ax * ay]];
      const col = [0, 0, 0];
      for (const [cx, cy, wt] of corners) {
        const p = (cy * coarse.w + cx) * 4, ca = Math.max(coarse.d[p + 3], 1e-6);
        for (let k = 0; k < 3; k++) col[k] += (coarse.d[p + k] / ca) * wt;
      }
      for (let k = 0; k < 3; k++) fine.d[q + k] += col[k] * (1 - a);
      fine.d[q + 3] = 1;
    }
  }
  // composite onto the full image with bilinear upsampling, then mark opaque
  const f = levels[0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4, a = data[p + 3] / 255;
    if (a >= 1) continue;
    const fx = Math.min(f.w - 1.001, Math.max(0, x / 4 - 0.5)), fy = Math.min(f.h - 1.001, Math.max(0, y / 4 - 0.5));
    const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    for (let k = 0; k < 3; k++) {
      const v = (f.d[(y0 * f.w + x0) * 4 + k] * (1 - ax) + f.d[(y0 * f.w + x0 + 1) * 4 + k] * ax) * (1 - ay)
        + (f.d[((y0 + 1) * f.w + x0) * 4 + k] * (1 - ax) + f.d[((y0 + 1) * f.w + x0 + 1) * 4 + k] * ax) * ay;
      data[p + k] = data[p + k] * a + v * (1 - a);
    }
    data[p + 3] = 255;
  }
  return img;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{blob: Blob, R: number[]}>} shots  photos + camera→world rotations
 * @param {{fovDeg?: number, width?: number, refine?: boolean, onProgress?: (stage: string, p: number) => void}} opts
 */
export async function stitchPanorama(shots, opts = {}) {
  const { fovDeg = 62, fovRange = 14, width = 4096, refine = true, onProgress } = opts;
  if (shots.length < 3) throw new Error('Need at least 3 photos');
  if (shots.length > MAX_SHOTS) throw new Error(`At most ${MAX_SHOTS} photos`);

  onProgress?.('prepare', 0);
  const bitmaps = [];
  for (let i = 0; i < shots.length; i++) {
    bitmaps.push(await createImageBitmap(shots[i].blob));
    onProgress?.('prepare', (i + 1) / shots.length);
  }

  // panorama yaw 0 = direction of the first photo
  const yaw0 = yawPitch(forward(shots[0].R))[0];
  const level = mat.rz(yaw0);
  const work = shots.map((s, i) => ({
    R: mat.mul(level, s.R),
    levels: refine ? [grayLevel(bitmaps[i], 48, 2), grayLevel(bitmaps[i], 96, 1), grayLevel(bitmaps[i], 192, 1), grayLevel(bitmaps[i], 384, 1)] : [],
  }));

  let rotations = work.map((s) => s.R);
  let fov = fovDeg;
  let gains = work.map(() => 1);
  let stats = null;
  if (refine) {
    const res = refineAlignment(work, 4, fovDeg, (p) => onProgress?.('align', p), { fovRange, onStage: opts.onStage, debug: opts.debug });
    rotations = res.rotations; fov = res.fov;
    gains = solveGains(work.length, res.overlaps);
    stats = { cost: res.cost, pairs: res.pairs };
    await new Promise((r) => setTimeout(r, 0));
  }

  // Uploading row-major R as a column-major GLSL mat3 gives R^T (world → camera), which the shader needs
  const img = await renderEquirect(bitmaps, rotations, gains, fov, width, (p) => onProgress?.('render', p));
  bitmaps.forEach((b) => b.close?.());

  onProgress?.('finish', 0.3);
  fillHoles(img);
  const canvas = makeCanvas(img.width, img.height);
  canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  onProgress?.('finish', 1);
  return { blob, width: img.width, height: img.height, fovDeg: fov, gains, rotations, stats };
}
