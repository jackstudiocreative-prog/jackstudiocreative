// Preview & Publish — status of every project; publishing; share link, QR code, Shopify embed
import { loadIndex, loadProject, publishProject, unpublishProject, mediaURL } from '../store.js';
import { SITE_BASE } from '../config.js';
import { esc, toast, statusBadge, timeAgo, TYPE_LABEL, copyText, busy } from '../ui.js';
import qrcode from '../../../assets/vendor/qrcode/qrcode.mjs';

const pageURL = (p) => `${SITE_BASE}/${p.type === 'showroom' ? 'showroom' : 'product'}.html?id=${encodeURIComponent(p.id)}`;

export async function render(el, ctx) {
  return ctx.param ? renderShare(el, ctx) : renderList(el, ctx);
}

async function renderList(el, { user, go, saved }) {
  const index = await loadIndex();
  const order = { changed: 0, draft: 1, published: 2 };
  const list = [...index.projects].sort((a, b) => order[a.status] - order[b.status] || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  el.innerHTML = `
    <div class="page-head"><h1>Preview &amp; Publish</h1></div>
    <p class="sub">Preview shows the latest saved draft. Publishing makes it visible on the public site.</p>
    ${list.length ? `<div class="table">${list.map((p) => `
      <div class="row-item">
        ${p.cover ? `<img src="${esc(mediaURL(p.cover))}" alt="" class="${p.type === 'showroom' ? 'wide' : ''}">` : '<div class="ph"></div>'}
        <div class="grow">
          <a href="#/project/${encodeURIComponent(p.id)}"><b>${esc(p.title)}</b></a>
          <div class="meta"><span>${TYPE_LABEL[p.type]}</span>${statusBadge(p.status)}<span>${p.publishedAt ? `published ${timeAgo(p.publishedAt)}` : `edited ${timeAgo(p.updatedAt)}`}</span></div>
        </div>
        <div class="inline">
          <a class="btn btn--ghost btn--sm" href="${esc(pageURL(p))}&preview=1" target="_blank" rel="noopener">Preview</a>
          ${p.status !== 'published' ? `<button class="btn btn--sm" type="button" data-publish="${esc(p.id)}">${p.status === 'changed' ? 'Publish changes' : 'Publish'}</button>` : ''}
          ${p.published ? `<a class="btn btn--ghost btn--sm" href="#/publish/${encodeURIComponent(p.id)}">Share</a>` : ''}
        </div>
      </div>`).join('')}</div>` : '<div class="empty">No projects yet. <a href="#/new">Create one</a>.</div>'}`;

  el.querySelectorAll('[data-publish]').forEach((b) => b.addEventListener('click', () => busy(b, 'Publishing…', async () => {
    try {
      const { project, sha } = await loadProject(b.dataset.publish);
      const empty = project.type === 'product' ? !project.draft.spin && !project.draft.model : !project.draft.scenes.length;
      if (empty) { toast('This project has no media yet — open it and add some first', true); return; }
      await publishProject(project, user, sha);
      saved();
      toast('Published');
      go(`#/publish/${encodeURIComponent(project.id)}`);
    } catch (err) { toast(err.message, true); }
  })));
  return {};
}

async function renderShare(el, { user, param, go, saved }) {
  const { project: p, sha } = await loadProject(param);
  if (!p.published) {
    el.innerHTML = `<div class="page-head"><div><a class="link-btn" href="#/publish">← Preview &amp; Publish</a><h1>${esc(p.title)}</h1></div></div>
      <div class="empty">This project is not published yet. <a href="#/project/${encodeURIComponent(p.id)}">Open it</a> and press Publish.</div>`;
    return {};
  }
  const url = pageURL(p);
  const embedURL = `${url}&embed=1`;
  const ratio = p.type === 'showroom' ? '16 / 9' : '1 / 1';
  const embed = `<div style="position:relative;width:100%;aspect-ratio:${ratio};max-width:${p.type === 'showroom' ? '1200px' : '720px'};margin:0 auto">
  <iframe src="${embedURL}" title="${esc(p.title)} — 360° view" loading="lazy" allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>
</div>`;

  el.innerHTML = `
    <div class="page-head">
      <div><a class="link-btn" href="#/publish">← Preview &amp; Publish</a><h1>Share “${esc(p.title)}”</h1>
        <p class="status">Published ${timeAgo(p.publishedAt)} by ${esc(p.publishedBy || '')}. New publishes go live in about a minute.</p></div>
      <div class="actions">
        <button class="btn btn--danger btn--sm" type="button" id="unpublish">Unpublish</button>
        <a class="btn btn--ghost btn--sm" href="#/project/${encodeURIComponent(p.id)}">Edit</a>
      </div>
    </div>
    <div class="share">
      <section class="panel">
        <h2>Share link</h2>
        <div class="copy-row"><input class="input" readonly value="${esc(url)}" aria-label="Share link"><button class="btn btn--sm" type="button" id="copy-link">Copy</button></div>
        <div class="inline" style="margin-top:10px"><a class="btn btn--ghost btn--sm" href="${esc(url)}" target="_blank" rel="noopener">Open page ↗</a></div>
      </section>
      <section class="panel">
        <h2>QR code</h2>
        <p class="sub">For counters, price tags and printed material.</p>
        <div class="qr" id="qr"></div>
        <a class="btn btn--ghost btn--sm" id="qr-download" download="${esc(p.id)}-qr.png">Download PNG</a>
      </section>
      <section class="panel share-wide">
        <h2>Shopify embed</h2>
        <p class="sub">In Shopify: Online Store → Themes → Customize → add a <b>Custom liquid</b> section (or a Custom HTML block) → paste this code.</p>
        <textarea class="textarea code" readonly rows="6" aria-label="Embed code">${esc(embed)}</textarea>
        <button class="btn btn--sm" type="button" id="copy-embed">Copy embed code</button>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  $('#copy-link').addEventListener('click', (e) => copyText(url, e.currentTarget));
  $('#copy-embed').addEventListener('click', (e) => copyText(embed, e.currentTarget));

  // QR code drawn on a canvas in brand colours (dark espresso on white keeps it scannable)
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount(), cell = 8, quiet = 4, size = (n + quiet * 2) * cell;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#401410';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', `QR code for ${url}`);
  $('#qr').append(cv);
  $('#qr-download').href = cv.toDataURL('image/png');

  $('#unpublish').addEventListener('click', () => {
    if (!confirm(`Unpublish "${p.title}"? The public page and QR code stop working until you publish again.`)) return;
    busy($('#unpublish'), 'Unpublishing…', async () => {
      try { await unpublishProject(p, user, sha); saved(); toast('Unpublished'); go('#/publish'); }
      catch (err) { toast(err.message, true); }
    });
  });
  return {};
}
