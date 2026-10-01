// GitHub as the Studio's backend: sign-in, roles, reading files and atomic multi-file commits.
// Every save is one commit; GitHub Pages then republishes the site automatically.
// Two repositories are used: the public website (REPO) and a private photo library (PHOTOS_REPO).
import { REPO, PHOTOS_REPO } from './config.js';

const API = 'https://api.github.com';
const TOKEN_KEY = 'js360-token';

let token = null;
try { token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch {}

export const hasToken = () => Boolean(token);

export function setToken(t, remember) {
  token = t;
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch {}
}

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export class ConflictError extends Error {}

async function request(method, path, body, accept = 'application/vnd.github+json') {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GitHubError('Cannot reach GitHub. Check your internet connection.', 0);
  }
  return res;
}

async function gh(method, path, body) {
  const res = await request(method, path, body);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    let msg = data?.message || `GitHub error ${res.status}`;
    if (res.status === 401) msg = 'Your sign-in key is invalid or expired. Please sign in again.';
    if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub rate limit reached. Please wait a few minutes.';
    throw new GitHubError(msg, res.status);
  }
  return data;
}

/* ---------------- encoding helpers ---------------- */

const utf8ToB64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64) => {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};
const blobToB64 = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});
const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

/* ---------------- a client per repository ---------------- */

function repoClient(owner, name, defaultBranch = 'main') {
  const R = `/repos/${owner}/${name}`;
  let branch = defaultBranch;

  async function readText(path, ref = branch) {
    try {
      const f = await gh('GET', `${R}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      if (Array.isArray(f) || f.type !== 'file') throw new GitHubError(`${path} is not a file`, 400);
      if (f.content == null || f.encoding !== 'base64' || (f.size > 0 && !f.content)) {
        const blob = await gh('GET', `${R}/git/blobs/${f.sha}`); // files over 1 MB
        return { text: b64ToUtf8(blob.content), sha: f.sha };
      }
      return { text: b64ToUtf8(f.content), sha: f.sha };
    } catch (e) {
      if (e.status === 404) return { text: null, sha: null };
      throw e;
    }
  }

  async function readJSON(path, ref) {
    const { text, sha } = await readText(path, ref);
    return { data: text == null ? null : JSON.parse(text), sha };
  }

  /** Any file as a Blob (works for private repositories, up to 100 MB). */
  async function getRaw(path) {
    const res = await request('GET', `${R}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`, null, 'application/vnd.github.raw+json');
    if (!res.ok) throw new GitHubError(res.status === 404 ? 'File not found' : `GitHub error ${res.status}`, res.status);
    return res.blob();
  }

  async function headCommit() {
    const ref = await gh('GET', `${R}/git/ref/heads/${branch}`);
    const c = await gh('GET', `${R}/git/commits/${ref.object.sha}`);
    return { sha: ref.object.sha, tree: c.tree.sha };
  }

  async function listFiles(prefix = '') {
    const head = await headCommit();
    const t = await gh('GET', `${R}/git/trees/${head.tree}?recursive=1`);
    return t.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix)).map((e) => ({ path: e.path, sha: e.sha, size: e.size }));
  }

  /**
   * One atomic commit.
   *  put:    [{ path, content: string | Blob }]        — new or replaced files
   *  update: [{ path, fn: (oldText|null) => newText }] — read-modify-write against the latest version
   *  remove: [path]                                     — deleted files (missing paths are ignored)
   *  expect: { path: sha|null }                         — fail with ConflictError if someone changed these
   * Retries automatically when someone else committed in between.
   */
  async function commit({ message, put = [], update = [], remove = [], expect = {}, onProgress }) {
    const blobCache = new Map();
    const total = put.length + update.length;
    let done = 0;

    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await headCommit();

      for (const [path, sha] of Object.entries(expect)) {
        const cur = await readText(path, head.sha);
        if ((cur.sha || null) !== (sha || null)) {
          throw new ConflictError(`Someone else changed "${path}" since you opened it. Reload to get the latest version, then make your change again.`);
        }
      }

      let existing = null;
      if (remove.length) {
        const t = await gh('GET', `${R}/git/trees/${head.tree}?recursive=1`);
        existing = new Set(t.tree.filter((e) => e.type === 'blob').map((e) => e.path));
      }

      const entries = [];
      for (const p of put) {
        if (!blobCache.has(p.path)) {
          const content = typeof p.content === 'string' ? utf8ToB64(p.content) : await blobToB64(p.content);
          const b = await gh('POST', `${R}/git/blobs`, { content, encoding: 'base64' });
          blobCache.set(p.path, b.sha);
          onProgress?.(++done / Math.max(1, total));
        }
        entries.push({ path: p.path, mode: '100644', type: 'blob', sha: blobCache.get(p.path) });
      }
      for (const u of update) {
        const cur = await readText(u.path, head.sha);
        const next = u.fn(cur.text);
        if (next == null) continue;
        const b = await gh('POST', `${R}/git/blobs`, { content: utf8ToB64(next), encoding: 'base64' });
        entries.push({ path: u.path, mode: '100644', type: 'blob', sha: b.sha });
        if (attempt === 0) onProgress?.(++done / Math.max(1, total));
      }
      for (const path of remove) {
        if (existing.has(path) && !entries.some((e) => e.path === path)) entries.push({ path, mode: '100644', type: 'blob', sha: null });
      }
      if (!entries.length) return { sha: head.sha };

      const tree = await gh('POST', `${R}/git/trees`, { base_tree: head.tree, tree: entries });
      const c = await gh('POST', `${R}/git/commits`, { message, tree: tree.sha, parents: [head.sha] });
      try {
        await gh('PATCH', `${R}/git/refs/heads/${branch}`, { sha: c.sha, force: false });
        return { sha: c.sha };
      } catch (e) {
        if (e.status !== 422 && e.status !== 409) throw e; // someone saved first — try again on top of theirs
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      }
    }
    throw new GitHubError('Could not save because others were saving at the same moment. Please try again.', 409);
  }

  /** Repository info, or null if it doesn't exist / this account can't see it. Also learns the default branch. */
  async function info() {
    try {
      const r = await gh('GET', R);
      branch = r.default_branch || branch;
      return r;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  const collaborators = () => gh('GET', `${R}/collaborators?per_page=100&affiliation=all`);
  const invitations = () => gh('GET', `${R}/invitations?per_page=100`).catch(() => []);
  const setMember = (login, role) => gh('PUT', `${R}/collaborators/${encodeURIComponent(login)}`, { permission: role === 'admin' ? 'admin' : 'push' });
  const removeMember = (login) => gh('DELETE', `${R}/collaborators/${encodeURIComponent(login)}`);
  const cancelInvite = (id) => gh('DELETE', `${R}/invitations/${id}`);

  return { owner, name, R, readText, readJSON, getRaw, listFiles, commit, info, collaborators, invitations, setMember, removeMember, cancelInvite };
}

export const site = repoClient(REPO.owner, REPO.repo, REPO.branch);
export const photos = repoClient(REPO.owner, PHOTOS_REPO);

// The website repository is the default for the rest of the Studio
export const { readText, readJSON, listFiles, commit } = site;

/* ---------------- Sign-in & roles ---------------- */

/** Verifies the key and returns the user and their role in the website repository. */
export async function whoAmI() {
  const user = await gh('GET', '/user');
  let repo;
  try { repo = await gh('GET', site.R); }
  catch (e) {
    if (e.status === 404) throw new GitHubError('This account has no access to the Jack Studio 360 repository. Ask an admin to invite you.', 404);
    throw e;
  }
  const p = repo.permissions || {};
  if (!p.push) throw new GitHubError('This account can view but not edit. Ask an admin to give you Staff access.', 403);
  return { login: user.login, name: user.name || user.login, avatar: user.avatar_url, role: p.admin ? 'admin' : 'staff' };
}

/* ---------------- Photo library repository ---------------- */

/** 'ready' | 'missing' (not created yet) | 'no-access' (exists, but this account isn't a member yet) */
export async function photoLibraryState(user) {
  const r = await photos.info();
  if (r) return r.permissions?.push ? 'ready' : 'no-access';
  // 404 means either "doesn't exist" or "exists but private to others"; only the owner can tell the difference
  return user.login.toLowerCase() === REPO.owner.toLowerCase() ? 'missing' : 'no-access';
}

/** Creates the private photo repository (owner only) and gives the current team access. */
export async function createPhotoLibrary(onStep) {
  onStep?.('Creating the private photo repository…');
  await gh('POST', '/user/repos', {
    name: PHOTOS_REPO, private: true, auto_init: true,
    description: 'Jack Studio product photo library (private) — managed by the Jack Studio 360 Studio',
  });
  // GitHub needs a moment before the new repository accepts commits
  for (let i = 0; i < 10; i++) {
    const r = await photos.info();
    if (r) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  onStep?.('Preparing the photo index…');
  await photos.commit({ message: 'Set up photo library', put: [{ path: 'photos.json', content: '{\n  "photos": []\n}\n' }] });
  onStep?.('Giving the team access…');
  await syncPhotoAccess();
}

/** Makes the photo repository's members match the website repository's members. */
export async function syncPhotoAccess() {
  const [siteMembers, siteInvites] = await Promise.all([site.collaborators(), site.invitations()]);
  const ownerLc = REPO.owner.toLowerCase();
  const tasks = [];
  for (const m of siteMembers) {
    if (m.login.toLowerCase() === ownerLc) continue;
    tasks.push(photos.setMember(m.login, m.permissions?.admin ? 'admin' : 'staff').catch(() => null));
  }
  for (const i of siteInvites) {
    if (i.invitee?.login) tasks.push(photos.setMember(i.invitee.login, i.permissions === 'admin' ? 'admin' : 'staff').catch(() => null));
  }
  await Promise.all(tasks);
}

/* ---------------- Team (admin): applied to both repositories ---------------- */

export async function listTeam() {
  const [collabs, invites] = await Promise.all([site.collaborators(), site.invitations()]);
  return {
    members: collabs.map((c) => ({
      login: c.login, avatar: c.avatar_url,
      role: c.permissions?.admin ? 'admin' : c.permissions?.push ? 'staff' : 'viewer',
      owner: c.login.toLowerCase() === REPO.owner.toLowerCase(),
    })),
    invites: invites.map((i) => ({ id: i.id, login: i.invitee?.login, role: i.permissions === 'admin' ? 'admin' : 'staff', created: i.created_at })),
  };
}

const alsoPhotos = (fn) => fn().catch((e) => { if (e.status !== 404) throw e; }); // photo library may not exist yet

export async function inviteMember(login, role) {
  const res = await site.setMember(login, role);
  await alsoPhotos(() => photos.setMember(login, role));
  return res;
}
export async function removeMember(login) {
  await site.removeMember(login);
  await alsoPhotos(() => photos.removeMember(login));
}
export async function cancelInvite(id) {
  const list = await site.invitations();
  const login = list.find((i) => i.id === Number(id))?.invitee?.login;
  await site.cancelInvite(id);
  if (login) {
    const pi = await photos.invitations().catch(() => []);
    const match = pi.find((i) => i.invitee?.login === login);
    if (match) await alsoPhotos(() => photos.cancelInvite(match.id));
  }
}

/* ---------------- Site status ---------------- */

/** 'built' | 'building' | 'errored' | 'unknown' and the commit it was built from */
export async function siteStatus() {
  try {
    const b = await gh('GET', `${site.R}/pages/builds/latest`);
    return { status: b.status, commit: b.commit };
  } catch {
    return { status: 'unknown', commit: null };
  }
}
