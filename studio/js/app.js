// Studio shell: session, navigation, routing
import { hasToken, setToken, whoAmI, siteStatus } from './github.js';
import { toast, esc } from './ui.js';
import * as auth from './views/auth.js';
import * as home from './views/home.js';
import * as projects from './views/projects.js';
import * as newProject from './views/new-project.js';
import * as editor from './views/editor.js';
import * as library from './views/library.js';
import * as photoLibrary from './views/photos.js';
import * as assets from './views/assets.js';
import * as publish from './views/publish.js';
import * as team from './views/team.js';

const $ = (id) => document.getElementById(id);
const ROUTES = {
  '': ['home', home], projects: ['projects', projects], new: ['projects', newProject], project: ['projects', editor],
  library: ['library', library], photos: ['library', photoLibrary], assets: ['assets', assets], publish: ['publish', publish], team: ['team', team],
};

let user = null;
let current = null;
let routeSeq = 0;

/* ---------------- routing ---------------- */
function parseHash() {
  const [name = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, param: rest.length ? decodeURIComponent(rest.join('/')) : '' };
}

async function route() {
  const { name, param } = parseHash();
  current?.instance?.destroy?.();
  current = null;

  if (!user) return showAuth(name === 'forgot' ? 'forgot' : 'login');
  if (name === 'login' || name === 'forgot') { location.hash = '#/'; return; }

  let entry = ROUTES[name] || ROUTES[''];
  if (name === 'team' && user.role !== 'admin') entry = ROUTES[''];
  const [navKey, view] = entry;
  document.querySelectorAll('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === navKey ? 'page' : 'false'));
  const container = $('view');
  window.scrollTo(0, 0);
  // each page gets its own element, so a late refresh from a previous page can't overwrite this one
  const host = document.createElement('div');
  host.innerHTML = '<div class="loading">Loading…</div>';
  container.replaceChildren(host);
  const seq = ++routeSeq;
  try {
    const instance = await view.render(host, { user, param, go, saved: watchSite });
    if (seq === routeSeq) current = { instance };
    else instance?.destroy?.();
  } catch (err) {
    console.error(err);
    if (seq !== routeSeq) return;
    if (err.status === 401) return signOut(err.message);
    host.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

const isDirty = () => current?.instance?.isDirty?.() || false;
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (isDirty() && !confirm('You have unsaved changes. Leave this page?')) {
    history.replaceState(null, '', lastHash || '#/');
    return;
  }
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- session ---------------- */
function showAuth(mode, message) {
  $('app-view').hidden = true;
  $('auth-view').hidden = false;
  auth.render($('auth-view'), { mode, message, onSignedIn });
}

async function onSignedIn(u) {
  user = u;
  $('auth-view').hidden = true;
  $('app-view').hidden = false;
  $('user-chip').innerHTML = `${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : ''}<span>${esc(u.name)}</span><span class="badge ${u.role === 'admin' ? '' : 'badge--muted'}">${u.role === 'admin' ? 'Admin' : 'Staff'}</span>`;
  document.querySelectorAll('[data-admin]').forEach((el) => { el.hidden = u.role !== 'admin'; });
  document.querySelector('[data-nav="home"]').textContent = u.role === 'admin' ? 'Workspace' : 'My Workspace';
  if (location.hash === '#/login' || location.hash === '#/forgot') location.hash = '#/';
  route();
}

function signOut(message) {
  setToken(null);
  user = null;
  showAuth('login', message);
  history.replaceState(null, '', '#/login');
}

$('sign-out').addEventListener('click', () => {
  if (isDirty() && !confirm('You have unsaved changes. Sign out anyway?')) return;
  signOut();
});

/* ---------------- live-site status after saving ---------------- */
let watchTimer = null;
function watchSite() {
  const badge = $('site-status');
  badge.hidden = false;
  badge.className = 'site-status is-busy';
  badge.textContent = 'Updating live site…';
  clearInterval(watchTimer);
  const started = Date.now();
  watchTimer = setInterval(async () => {
    const s = await siteStatus();
    if (Date.now() - started < 15000) return; // GitHub needs a moment to start the build
    if (s.status === 'built' || s.status === 'unknown') {
      clearInterval(watchTimer);
      badge.className = 'site-status';
      badge.textContent = 'Live site up to date';
      setTimeout(() => { badge.hidden = true; }, 6000);
    } else if (s.status === 'errored') {
      clearInterval(watchTimer);
      badge.className = 'site-status is-error';
      badge.textContent = 'Live site update failed';
    }
    if (Date.now() - started > 5 * 60000) clearInterval(watchTimer);
  }, 8000);
}

/* ---------------- start ---------------- */
(async () => {
  if (!hasToken()) return showAuth(location.hash === '#/forgot' ? 'forgot' : 'login');
  try {
    await onSignedIn(await whoAmI());
  } catch (err) {
    if (err.status === 401 || err.status === 403 || err.status === 404) signOut(err.message);
    else { showAuth('login', err.message); toast(err.message, true); }
  }
})();
