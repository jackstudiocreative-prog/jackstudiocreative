// Create New Project → Select project type → name it → editor
import { loadIndex, newProject, saveProject } from '../store.js';
import { esc, slugify, uniqueId, toast, busy } from '../ui.js';

export async function render(el, { user, param, go, saved }) {
  const type = param === 'product' || param === 'showroom' ? param : null;

  if (!type) {
    el.innerHTML = `
      <div class="page-head"><h1>New Project</h1></div>
      <p class="sub">Select the project type.</p>
      <ul class="type-pick">
        <li><a href="#/new/product">
          <b>Product 360°</b>
          <span>Upload multi-angle photos (or a turntable video) and a 3D model if you have one. Customers drag to turn the product.</span>
        </a></li>
        <li><a href="#/new/showroom">
          <b>Showroom / Scene</b>
          <span>Upload 360° panoramas — from a 360° camera or captured with a phone — and add hotspots for products, areas and info.</span>
        </a></li>
      </ul>`;
    return {};
  }

  const label = type === 'product' ? 'Product 360°' : 'Showroom';
  el.innerHTML = `
    <div class="page-head">
      <div><a class="link-btn" href="#/new">← Project type</a><h1>New ${label}</h1></div>
    </div>
    <form class="panel narrow" id="form">
      <div class="field">
        <label for="title">Project name</label>
        <input class="input" id="title" required maxlength="80" placeholder="${type === 'product' ? 'e.g. Urban Tote Brown' : 'e.g. Klang Flagship Store'}">
      </div>
      <div class="field">
        <label for="pid">Page address</label>
        <input class="input" id="pid" pattern="[a-z0-9][a-z0-9\\-]*" maxlength="60">
        <span class="hint">Used in the link: …/${type === 'product' ? 'product' : 'showroom'}.html?id=<b id="pid-preview"></b></span>
      </div>
      <button class="btn" type="submit" id="create">Create project</button>
    </form>`;

  const $ = (s) => el.querySelector(s);
  const index = await loadIndex();
  const taken = new Set(index.projects.map((p) => p.id));
  let touched = false;
  const sync = () => { $('#pid-preview').textContent = $('#pid').value; };
  $('#title').addEventListener('input', () => {
    if (!touched) $('#pid').value = uniqueId(slugify($('#title').value) || type, taken);
    sync();
  });
  $('#pid').addEventListener('input', () => {
    touched = true;
    $('#pid').value = $('#pid').value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    sync();
  });
  $('#title').focus();

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#title').value.trim();
    const id = $('#pid').value.trim();
    if (!title) { toast('Give the project a name', true); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) { toast('Page address: lowercase letters, numbers and dashes only', true); return; }
    if (taken.has(id)) { toast('That page address is already used', true); return; }
    await busy($('#create'), 'Creating…', async () => {
      try {
        await saveProject(newProject(type, title, user, id), user, { message: `Create ${type} "${title}"` });
        saved();
        go(`#/project/${encodeURIComponent(id)}`);
      } catch (err) { toast(err.message, true); }
    });
  });
  return {};
}

export { esc };
