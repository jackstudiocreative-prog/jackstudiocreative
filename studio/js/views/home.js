// Workspace (admins) / My Workspace (staff)
import { loadIndex } from '../store.js';
import { esc } from '../ui.js';
import { projectGrid } from './common.js';

export async function render(el, { user }) {
  const index = await loadIndex();
  const all = index.projects;
  const mine = all.filter((p) => p.createdBy === user.login || p.updatedBy === user.login);
  const count = (s) => all.filter((p) => p.status === s).length;
  const isAdmin = user.role === 'admin';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow-sm">${isAdmin ? 'Workspace' : 'My Workspace'}</p>
        <h1>Hello, ${esc(user.name.split(' ')[0])}</h1>
      </div>
      <div class="actions"><a class="btn" href="#/new">+ New Project</a></div>
    </div>

    <ul class="quick">
      <li><a href="#/new/product"><b>Product 360°</b><span>Turn photos or a turntable video into a 360° product view</span></a></li>
      <li><a href="#/new/showroom"><b>Showroom</b><span>Build a walk-through from 360° panoramas with hotspots</span></a></li>
      <li><a href="../capture/" target="_blank" rel="noopener"><b>Capture with phone</b><span>Shoot a 360° panorama with a normal phone</span></a></li>
      <li><a href="#/library"><b>Product Library</b><span>Names, series and descriptions used across projects</span></a></li>
    </ul>

    <div class="stats">
      <div><b>${all.length}</b><span>Projects</span></div>
      <div><b>${count('published')}</b><span>Published</span></div>
      <div><b>${count('changed')}</b><span>Unpublished changes</span></div>
      <div><b>${count('draft')}</b><span>Drafts</span></div>
    </div>

    <section class="home-block">
      <div class="block-head"><h2>My projects</h2><a href="#/projects">All projects →</a></div>
      ${projectGrid(mine.slice(0, 8), 'Projects you create or edit appear here.')}
    </section>

    ${isAdmin ? `
    <section class="home-block">
      <div class="block-head"><h2>Recently updated by the team</h2><a href="#/publish">Preview &amp; Publish →</a></div>
      ${projectGrid(all.slice(0, 8), 'No projects yet.')}
    </section>
    <section class="home-block">
      <div class="block-head"><h2>Team</h2><a href="#/team">Manage accounts →</a></div>
      <p class="sub">Invite staff, set who is an admin, and remove access.</p>
    </section>` : ''}`;
  return {};
}
