// Project Management — all projects with filters
import { loadIndex } from '../store.js';
import { esc } from '../ui.js';
import { projectGrid } from './common.js';

export async function render(el, { user }) {
  const index = await loadIndex();
  el.innerHTML = `
    <div class="page-head">
      <h1>Projects</h1>
      <div class="actions"><a class="btn" href="#/new">+ New Project</a></div>
    </div>
    <div class="filters">
      <input class="input" id="q" type="search" placeholder="Search projects" aria-label="Search projects">
      <select class="select" id="type" aria-label="Type">
        <option value="">All types</option><option value="product">Product 360°</option><option value="showroom">Showroom</option>
      </select>
      <select class="select" id="status" aria-label="Status">
        <option value="">Any status</option><option value="draft">Draft</option><option value="changed">Unpublished changes</option><option value="published">Published</option>
      </select>
      <label class="check"><input type="checkbox" id="mine"> Only mine</label>
    </div>
    <div id="list"></div>`;

  const $ = (s) => el.querySelector(s);
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = index.projects.filter((p) =>
      (!q || p.title.toLowerCase().includes(q) || p.id.includes(q))
      && (!$('#type').value || p.type === $('#type').value)
      && (!$('#status').value || p.status === $('#status').value)
      && (!$('#mine').checked || p.createdBy === user.login || p.updatedBy === user.login));
    $('#list').innerHTML = `<p class="status">${list.length} of ${index.projects.length} projects</p>${projectGrid(list, index.projects.length ? 'No projects match these filters.' : 'No projects yet. Start with <a href="#/new">New Project</a>.')}`;
  };
  ['#q', '#type', '#status', '#mine'].forEach((s) => $(s).addEventListener('input', draw));
  draw();
  return {};
}

export { esc };
