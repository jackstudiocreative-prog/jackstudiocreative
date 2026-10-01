// SpinViewer — dependency-free 360° image-sequence viewer
// Drag / swipe to rotate, arrow keys for accessibility, frames preload progressively.

export class SpinViewer {
  constructor(container, frames, options = {}) {
    this.container = container;
    this.frames = frames;
    this.opts = { pxPerFrame: 8, reverse: false, hint: 'Drag to rotate', label: 'Product 360° view', ...options };
    this.index = 0;
    this.images = [];
    this.loaded = 0;
    this.build();
    this.preload();
    this.bind();
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
  }

  preload() {
    this.frames.forEach((src, i) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = im.onerror = () => {
        this.loaded += 1;
        this.progress.style.width = `${(this.loaded / this.frames.length) * 100}%`;
        if (this.loaded === this.frames.length) this.progress.remove();
      };
      im.src = src;
      this.images[i] = im;
    });
  }

  show(i) {
    const n = this.frames.length;
    this.index = ((i % n) + n) % n;
    this.img.src = this.frames[this.index];
  }

  interacted() {
    this.el.classList.add('has-interacted');
  }

  bind() {
    let startX = 0;
    let startIndex = 0;
    let pointerId = null;
    const dir = this.opts.reverse ? -1 : 1;

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startIndex = this.index;
      this.el.setPointerCapture(pointerId);
      this.el.classList.add('is-dragging');
      this.interacted();
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
        this.interacted();
        this.show(this.index + (e.key === 'ArrowRight' ? 1 : -1) * dir);
      }
    });
  }

  destroy() {
    this.el.remove();
  }
}
