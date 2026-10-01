// Small shared UI helpers for the Studio
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

export function uniqueId(base, taken) {
  let id = base || 'item';
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export const stamp = () => Date.now().toString(36);

let toastTimer;
export function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 3000);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const STATUS = {
  draft: { label: 'Draft', cls: 'badge--muted' },
  published: { label: 'Published', cls: '' },
  changed: { label: 'Unpublished changes', cls: 'badge--warn' },
};
export const statusBadge = (s) => `<span class="badge ${STATUS[s]?.cls || ''}">${STATUS[s]?.label || s}</span>`;
export const TYPE_LABEL = { product: 'Product 360°', showroom: 'Showroom' };

export async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } else toast('Copied');
}

/** Disables a button and shows a label while an async task runs. */
export async function busy(btn, label, task) {
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await task(); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}
