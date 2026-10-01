// Project editor: shared header + actions; the body is the Product 360° or Showroom editor
import { loadProject, saveProject, publishProject, deleteProject, statusOf } from '../store.js';
import { SITE_BASE } from '../config.js';
import { esc, toast, statusBadge, timeAgo, TYPE_LABEL, busy } from '../ui.js';
import { ConflictError } from '../github.js';
import { mountProductEditor } from './product-editor.js';
import { mountShowroomEditor } from './showroom-editor.js';

export async function render(el, { user, param, go, saved }) {
  const loaded = await loadProject(param);
  const p = loaded.project;
  let sha = loaded.sha;
  let savedJSON = JSON.stringify({ title: p.title, draft: p.draft });

  const canDelete = user.role === 'admin' || (p.createdBy === user.login && !p.published);
  el.innerHTML = `
    <div class="page-head editor-head">
      <div class="grow">
        <a class="link-btn" href="#/projects">← Projects</a>
        <input class="title-input" id="title" value="${esc(p.title)}" aria-label="Project name" maxlength="80">
        <p class="status proj-line"><span id="proj-status"></span>${TYPE_LABEL[p.type]} · <span id="proj-meta"></span></p>
      </div>
      <div class="actions">
        ${canDelete ? '<button class="btn btn--danger btn--sm" type="button" id="delete">Delete</button>' : ''}
        <button class="btn btn--ghost btn--sm" type="button" id="preview">Preview</button>
        <span class="unsaved" id="dirty" hidden><span class="dirty-dot"></span>Unsaved</span>
        <button class="btn btn--ghost" type="button" id="save">Save draft</button>
        <button class="btn" type="button" id="publish">Publish</button>
      </div>
    </div>
    <div id="body"></div>`;

  const $ = (s) => el.querySelector(s);
  const refreshHead = () => {
    $('#proj-status').innerHTML = statusBadge(statusOf(p));
    $('#proj-meta').textContent = `edited by ${p.updatedBy} ${timeAgo(p.updatedAt)}${p.publishedAt ? ` · published ${timeAgo(p.publishedAt)}` : ''}`;
  };
  refreshHead();

  const body = (p.type === 'product' ? mountProductEditor : mountShowroomEditor)($('#body'), { project: p, user, onChange: () => markDirty() });
  const isDirty = () => body.hasPending() || JSON.stringify({ title: p.title, draft: p.draft }) !== savedJSON;
  const markDirty = () => { $('#dirty').hidden = !isDirty(); };
  $('#title').addEventListener('input', () => { p.title = $('#title').value.trim() || p.title; markDirty(); });

  let saving = false;
  async function save({ quiet = false } = {}) {
    if (saving) return false;
    if (!$('#title').value.trim()) { toast('Give the project a name', true); return false; }
    saving = true;
    try {
      const { put = [], extraUpdates = [] } = await body.collect();
      const res = await saveProject(p, user, { sha, put, extraUpdates, onProgress: (x) => body.progress?.(x) });
      sha = res.sha;
      body.saved();
      savedJSON = JSON.stringify({ title: p.title, draft: p.draft });
      markDirty();
      refreshHead();
      saved();
      if (!quiet) toast('Draft saved');
      return true;
    } catch (err) {
      toast(err instanceof ConflictError ? err.message : `Could not save: ${err.message}`, true);
      return false;
    } finally {
      saving = false;
      body.progress?.(null);
    }
  }

  $('#save').addEventListener('click', () => busy($('#save'), 'Saving…', () => save()));

  $('#preview').addEventListener('click', async () => {
    if (isDirty()) {
      if (!confirm('Save your changes first, so the preview shows them?')) return;
      if (!(await busy($('#preview'), 'Saving…', () => save({ quiet: true })))) return;
      toast('Saved. The preview can take about a minute to show the newest changes.');
    }
    window.open(`${SITE_BASE}/${p.type === 'product' ? 'product' : 'showroom'}.html?id=${encodeURIComponent(p.id)}&preview=1`, '_blank', 'noopener');
  });

  $('#publish').addEventListener('click', () => busy($('#publish'), 'Publishing…', async () => {
    if (!body.ready()) return;
    if (isDirty() && !(await save({ quiet: true }))) return;
    try {
      sha = await publishProject(p, user, sha);
      savedJSON = JSON.stringify({ title: p.title, draft: p.draft });
      saved();
      toast('Published');
      go(`#/publish/${encodeURIComponent(p.id)}`);
    } catch (err) { toast(`Could not publish: ${err.message}`, true); }
  }));

  $('#delete')?.addEventListener('click', () => {
    if (!confirm(`Delete "${p.title}"? Its photos and panoramas are deleted too${p.published ? ', and the public page stops working' : ''}.`)) return;
    busy($('#delete'), 'Deleting…', async () => {
      try {
        await deleteProject(p, sha);
        savedJSON = null;
        body.discard?.();
        saved();
        toast('Project deleted');
        go('#/projects');
      } catch (err) { toast(err.message, true); }
    });
  });

  return {
    isDirty: () => savedJSON !== null && isDirty(),
    destroy: () => body.destroy?.(),
  };
}
