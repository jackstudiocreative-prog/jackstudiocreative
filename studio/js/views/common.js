// Shared bits for project lists
import { esc, statusBadge, timeAgo, TYPE_LABEL } from '../ui.js';
import { mediaURL } from '../store.js';

export function projectCard(p) {
  const cover = p.cover ? mediaURL(p.cover) : '';
  return `<li><a class="item" href="#/project/${encodeURIComponent(p.id)}">
    ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" ${p.type === 'showroom' ? 'style="aspect-ratio:2/1"' : ''}>` : `<div class="ph" ${p.type === 'showroom' ? 'style="aspect-ratio:2/1"' : ''}>No media yet</div>`}
    <div class="body">
      <h3>${esc(p.title)}</h3>
      <div class="meta"><span>${TYPE_LABEL[p.type]}</span>${statusBadge(p.status)}</div>
      <div class="meta"><span>${esc(p.updatedBy || '')} · ${timeAgo(p.updatedAt)}</span></div>
    </div>
  </a></li>`;
}

export const projectGrid = (list, empty) => list.length
  ? `<ul class="grid" style="list-style:none;margin:0;padding:0">${list.map(projectCard).join('')}</ul>`
  : `<div class="empty">${empty}</div>`;
