// SpinViewer — dependency-free 360° image-sequence viewer
// Drag / swipe to rotate, arrow keys for accessibility, frames preload progressively.
//
// Optional "open / close" action: a second photo sequence that shows the product opening
// (a zip, a flap, a lid). A hotspot sits on the product at the angle the sequence was shot;
// pressing it turns the product to that angle and plays the sequence, pressing it again closes it.
//   options.action = { frames: [url…], frame: 1, x: 0.5, y: 0.5, span: 2, label: 'Open', closeLabel: 'Close' }
//   frame  the spin frame (1-based) the sequence starts from — its first photo matches that frame
//   x, y   hotspot position on the photo, 0–1 from the top-left corner
//   span   the hotspot shows this many frames either side of `frame`

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function normaliseAction(action, frameCount) {
  if (!action || !Array.isArray(action.frames) || action.frames.length < 2 || !frameCount) return null;
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
  return {
    frames: action.frames,
    at: clamp(Math.round(num(action.frame, 1)) - 1, 0, frameCount - 1),
    x: clamp(num(action.x, 0.5), 0, 1),
    y: clamp(num(action.y, 0.5), 0, 1),
    span: Math.max(0, Math.round(num(action.span, 2))),
    label: String(action.label || 'Open'),
    closeLabel: String(action.closeLabel || 'Close'),
  };
}

export class SpinViewer {
  constructor(container, frames, options = {}) {
    this.container = container;
    this.frames = frames;
    this.opts = { pxPerFrame: 8, reverse: false, hint: 'Drag to rotate', label: 'Product 360° view', startIndex: 0, action: null, ...options };
    this.index = 0;
    this.images = [];
    this.loaded = 0;
    this.action = normaliseAction(this.opts.action, frames.length);
    this.opened = false;   // the action sequence is showing its last photo
    this.playing = false;  // an animation (turning to the angle, opening, closing) is running
    this.locked = false;   // rotation and the hotspot are switched off (used by the Studio while placing)
    this.runId = 0;
    this.build();
    this.preload();
    this.bind();
    if (this.opts.startIndex) this.show(this.opts.startIndex);
    else this.updateHotspot();
  }

  build() {
    this.el = document.createElement('div');
    this.el.className = 'spin';
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', `${this.opts.label}. Use left and right arrow keys to rotate.`);

    this.img = document.createElement('img');
    this.img.alt = '';
    this.img.src = this.frames[0];
    this.img.draggable = false;

    this.hint = document.createElement('span');
    this.hint.className = 'spin-hint';
    this.hint.textContent = this.opts.hint;

    this.progress = document.createElement('span');
    this.progress.className = 'spin-progress';
    this.progress.style.width = '0%';

    this.el.append(this.img, this.hint, this.progress);
    this.container.append(this.el);

    if (this.action) {
      // A real button beside the spin (not inside it: the spin is one image to assistive technology).
      this.hs = document.createElement('button');
      this.hs.type = 'button';
      this.hs.className = 'hs spin-hs';
      this.hs.innerHTML = '<span class="hs-dot" aria-hidden="true">+</span><span class="hs-label"></span>';
      this.hs.hidden = true;
      this.hs.addEventListener('click', () => this.toggleAction());
      this.container.append(this.hs);
      this.img.addEventListener('load', () => this.placeHotspot());
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.placeHotspot());
        this.resizeObserver.observe(this.el);
      }
    }
  }

  preload() {
    this.frames.forEach((src, i) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = im.onerror = () => {
        this.loaded += 1;
        this.progress.style.width = `${(this.loaded / this.frames.length) * 100}%`;
        if (this.loaded === this.frames.length) {
          this.progress.remove();
          this.preloadAction(); // the opening photos load after the spin, so the spin is never held up
        }
      };
      im.src = src;
      this.images[i] = im;
    });
  }

  /** Loads the opening photos once; resolves when they are all in the browser cache. */
  preloadAction() {
    if (!this.action) return Promise.resolve();
    if (!this.actionReady) {
      this.actionImages = [];
      this.actionReady = Promise.all(this.action.frames.map((src, i) => new Promise((resolve) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = im.onerror = resolve;
        im.src = src;
        this.actionImages[i] = im;
      })));
    }
    return this.actionReady;
  }

  show(i) {
    const n = this.frames.length;
    this.index = ((i % n) + n) % n;
    this.img.src = this.frames[this.index];
    this.updateHotspot();
  }

  interacted() {
    this.el.classList.add('has-interacted');
  }

  /* ---------- open / close action ---------- */

  /** Where the photo sits inside the viewer (it is letter-boxed with object-fit: contain). */
  imageBox() {
    const r = this.el.getBoundingClientRect();
    const nw = this.img.naturalWidth, nh = this.img.naturalHeight;
    if (!nw || !nh || !r.width || !r.height) return null;
    const s = Math.min(r.width / nw, r.height / nh);
    const width = nw * s, height = nh * s;
    return { left: (r.width - width) / 2, top: (r.height - height) / 2, width, height, rect: r };
  }

  /** Page coordinates → position on the photo (0–1), or null when the point is outside the photo. */
  pointToImage(clientX, clientY) {
    const box = this.imageBox();
    if (!box) return null;
    const x = (clientX - box.rect.left - box.left) / box.width;
    const y = (clientY - box.rect.top - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  }

  placeHotspot() {
    if (!this.hs) return;
    const box = this.imageBox();
    if (!box) return;
    this.hs.style.left = `${box.left + this.action.x * box.width}px`;
    this.hs.style.top = `${box.top + this.action.y * box.height}px`;
    this.hs.classList.toggle('spin-hs--left', this.action.x > 0.55); // keep the label inside the stage
  }

  updateHotspot() {
    if (!this.hs) return;
    const n = this.frames.length;
    const away = Math.abs(this.index - this.action.at);
    const near = Math.min(away, n - away) <= this.action.span;
    this.hs.hidden = !(this.opened || this.playing || near);
    const label = this.opened ? this.action.closeLabel : this.action.label;
    this.hs.firstElementChild.textContent = this.opened ? '−' : '+';
    this.hs.lastElementChild.textContent = label;
    this.hs.setAttribute('aria-label', label);
    this.hs.setAttribute('aria-pressed', String(this.opened));
    this.hs.classList.toggle('is-open', this.opened);
    this.placeHotspot();
  }

  /** Runs `count` steps, `ms` apart; resolves false if another animation or destroy() interrupted it. */
  run(count, ms, step) {
    const id = ++this.runId;
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        if (id !== this.runId) return resolve(false);
        if (i >= count) return resolve(true);
        step(i);
        i += 1;
        this.timer = setTimeout(tick, ms);
      };
      tick();
    });
  }

  /** Turns the product the short way round to a frame. */
  rotateTo(target) {
    const n = this.frames.length;
    let delta = (((target - this.index) % n) + n) % n;
    if (delta > n / 2) delta -= n;
    if (!delta) return Promise.resolve(true);
    if (reducedMotion()) { this.show(target); return Promise.resolve(true); }
    const from = this.index, dir = Math.sign(delta), steps = Math.abs(delta);
    return this.run(steps, clamp(400 / steps, 16, 45), (i) => this.show(from + dir * (i + 1)));
  }

  async playAction(open) {
    const a = this.action;
    const last = a.frames.length - 1;
    const order = open ? a.frames.map((_, i) => i) : a.frames.map((_, i) => last - i);
    this.playing = true;
    this.updateHotspot();
    await this.preloadAction();
    const done = reducedMotion()
      ? true
      : await this.run(order.length, clamp(1600 / order.length, 40, 120), (i) => { this.img.src = a.frames[order[i]]; });
    if (!done) return;
    this.playing = false;
    this.opened = open;
    if (open) { this.img.src = a.frames[last]; this.updateHotspot(); }
    else this.show(a.at); // back on the spin photo of the same angle
  }

  /** The hotspot: open if closed (turning to the right angle first), close if open. */
  async toggleAction() {
    if (!this.action || this.playing || this.locked) return;
    this.interacted();
    if (this.opened) return this.playAction(false);
    this.playing = true;
    this.updateHotspot();
    if (!(await this.rotateTo(this.action.at))) return;
    return this.playAction(true);
  }

  /** Switches rotation and the hotspot off or on (the Studio uses this while a hotspot is being placed). */
  lock(on) {
    this.locked = Boolean(on);
    this.el.classList.toggle('is-locked', this.locked);
    if (this.hs) this.hs.style.pointerEvents = this.locked ? 'none' : '';
  }

  bind() {
    let startX = 0;
    let startIndex = 0;
    let pointerId = null;
    const dir = this.opts.reverse ? -1 : 1;

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.locked || this.playing) return;
      this.interacted();
      if (this.opened) { this.playAction(false); return; } // a drag on the open product closes it first
      pointerId = e.pointerId;
      startX = e.clientX;
      startIndex = this.index;
      this.el.setPointerCapture(pointerId);
      this.el.classList.add('is-dragging');
    });

    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      const delta = Math.round((e.clientX - startX) / this.opts.pxPerFrame);
      this.show(startIndex - delta * dir);
    });

    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      this.el.classList.remove('is-dragging');
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);

    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (this.locked || this.playing) return;
        this.interacted();
        if (this.opened) { this.playAction(false); return; }
        this.show(this.index + (e.key === 'ArrowRight' ? 1 : -1) * dir);
      }
    });
  }

  destroy() {
    this.runId += 1; // stops any running animation
    clearTimeout(this.timer);
    this.resizeObserver?.disconnect();
    this.hs?.remove();
    this.el.remove();
  }
}
