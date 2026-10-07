// Jack Studio 360 sign-in service — shared code for the functions in /api.
//
// What the service does: an admin creates accounts (username + password) in the Studio.
// A person signs in here; the service checks the password and hands the Studio a GitHub
// key that works for one hour, for the Studio's repositories only. Nobody but the service
// holds the long-lived secret, so switching an account off takes effect within the hour.
//
// The only setting is the environment variable STUDIO_KEY, made by the Studio's Team page.
// It holds the GitHub App's id and private key. No database: the account list is kept,
// encrypted, in the website repository on its own branch.
const crypto = require('crypto');

const CONFIG = {
  owner: process.env.STUDIO_OWNER || 'jackstudiocreative-prog',
  site: process.env.STUDIO_REPO || 'jackstudiocreative',
  photos: process.env.STUDIO_PHOTOS_REPO || 'jackstudio-photos', // private photo library; may not exist
  branch: 'studio-accounts',  // holds only the encrypted account list, so the website is not rebuilt when it changes
  file: 'accounts.json',
  api: process.env.GITHUB_API || 'https://api.github.com', // changed only by the tests
};

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/* ---------------- small helpers ---------------- */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const now = () => Math.floor(Date.now() / 1000);

/** STUDIO_KEY → { id, pem }. Accepts the one-line value from the Studio, or the JSON itself. */
function readKey() {
  const raw = (process.env.STUDIO_KEY || '').trim();
  if (!raw) throw new HttpError(503, 'The sign-in service is not set up yet: STUDIO_KEY is missing.', 'no-key');
  let obj = null;
  for (const text of [raw, safe(() => fromB64u(raw).toString('utf8')), safe(() => Buffer.from(raw, 'base64').toString('utf8'))]) {
    obj = safe(() => JSON.parse(text));
    if (obj && obj.id && obj.pem) break;
    obj = null;
  }
  if (!obj) throw new HttpError(503, 'STUDIO_KEY is not complete. Copy it again from the Studio (Team → Staff accounts) and paste the whole value.', 'bad-key');
  return { id: String(obj.id), pem: fixPem(String(obj.pem)) };
}
function safe(fn) { try { return fn(); } catch { return null; } }

/** Puts a private key back in shape if its line breaks were lost on the way. */
function fixPem(pem) {
  const m = pem.replace(/\\n/g, '\n').match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return pem;
  const body = m[2].replace(/\s+/g, '').replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN ${m[1]}-----\n${body}\n-----END ${m[1]}-----\n`;
}

let secrets = null; // derived once per running copy of the service
function keys() {
  if (secrets) return secrets;
  const { id, pem } = readKey();
  let privateKey;
  try { privateKey = crypto.createPrivateKey(pem); }
  catch { throw new HttpError(503, 'The private key inside STUDIO_KEY cannot be read. Copy it again from the Studio.', 'bad-key'); }
  // sessions and the account list are protected with keys derived from the private key,
  // so there is nothing else to configure. (A new private key signs everyone out.)
  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(pem), Buffer.alloc(0), info, 32));
  secrets = { id, privateKey, session: derive('js360-session'), store: derive('js360-accounts') };
  return secrets;
}

/* ---------------- GitHub ---------------- */
async function gh(method, path, { token, body, jwt } = {}) {
  let res;
  try {
    res = await fetch(CONFIG.api + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'jack-studio-360-sign-in',
        Authorization: `Bearer ${jwt || token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(502, 'The sign-in service cannot reach GitHub right now. Try again in a moment.', 'github-down');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new HttpError(res.status, (data && data.message) || `GitHub error ${res.status}`, 'github');
    err.github = true;
    throw err;
  }
  return data;
}

/** A short-lived token that proves "I am the GitHub App". */
function appJwt() {
  const { id, privateKey } = keys();
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const t = now();
  const payload = b64u(JSON.stringify({ iat: t - 60, exp: t + 540, iss: id }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), privateKey);
  return `${head}.${payload}.${b64u(sig)}`;
}

let installation = null; // { id } — where the app is installed for the website repository
async function installationId() {
  if (installation) return installation.id;
  try {
    const i = await gh('GET', `/repos/${CONFIG.owner}/${CONFIG.site}/installation`, { jwt: appJwt() });
    installation = { id: i.id };
    return i.id;
  } catch (e) {
    if (e.github && e.status === 404) throw new HttpError(503, `The GitHub App is not installed on ${CONFIG.owner}/${CONFIG.site} yet (Team → Staff accounts, step 2).`, 'not-installed');
    if (e.github && e.status === 401) throw new HttpError(503, 'GitHub does not accept STUDIO_KEY. Copy it again from the Studio, or create the GitHub App again.', 'bad-key');
    throw e;
  }
}

/**
 * A GitHub key for the Studio's repositories that stops working after an hour.
 * The photo library is included when the app can reach it.
 */
async function mintToken(retry = true) {
  const id = await installationId();
  const ask = (repositories) => gh('POST', `/app/installations/${id}/access_tokens`, { jwt: appJwt(), body: { repositories } });
  try {
    const t = await ask([CONFIG.site, CONFIG.photos]);
    return { token: t.token, expiresAt: t.expires_at, photos: true };
  } catch (e) {
    if (!(e.github && (e.status === 422 || e.status === 404))) throw e; // the photo library is missing, or the app is not installed on it
  }
  try {
    const t = await ask([CONFIG.site]);
    return { token: t.token, expiresAt: t.expires_at, photos: false };
  } catch (e) {
    // the app was removed and installed again: the installation has a new number
    if (retry && e.github && e.status === 404) { installation = null; return mintToken(false); }
    throw e;
  }
}

let own = null; // the service's own key, reused until shortly before it runs out
async function serviceToken() {
  if (own && new Date(own.expiresAt).getTime() - Date.now() > 5 * 60000) return own.token;
  own = await mintToken();
  return own.token;
}
/** Runs fn(token) with the service's own key; if GitHub no longer accepts that key, gets a new one and tries once more. */
async function asService(fn) {
  try { return await fn(await serviceToken()); }
  catch (e) {
    if (!(e.github && e.status === 401)) throw e;
    own = null;
    return fn(await serviceToken());
  }
}

/* ---------------- the account list ---------------- */
// { accounts: [{ username, name, role, active, salt, hash, ver, createdAt, createdBy, updatedAt }] }
const R = () => `/repos/${CONFIG.owner}/${CONFIG.site}`;

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys().store, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: b64u(iv), tag: b64u(c.getAuthTag()), data: b64u(data) }) + '\n';
}
function unseal(text) {
  try {
    const box = JSON.parse(text);
    const d = crypto.createDecipheriv('aes-256-gcm', keys().store, fromB64u(box.iv));
    d.setAuthTag(fromB64u(box.tag));
    return JSON.parse(Buffer.concat([d.update(fromB64u(box.data)), d.final()]).toString('utf8'));
  } catch {
    throw new HttpError(409, 'The saved accounts were made with a different STUDIO_KEY and cannot be read with this one.', 'unreadable');
  }
}

/** → { accounts, sha } ; sha is null when nothing has been saved yet. */
/** The saved file as GitHub has it ({ content, sha }), or null when nothing was saved yet. */
async function accountsFile() {
  try { return await asService((token) => gh('GET', `${R()}/contents/${CONFIG.file}?ref=${CONFIG.branch}`, { token })); }
  catch (e) { if (e.github && e.status === 404) return null; throw e; }
}

async function loadAccounts() {
  const f = await accountsFile();
  if (!f) return { accounts: [], sha: null };
  const store = unseal(Buffer.from(f.content || '', 'base64').toString('utf8'));
  return { accounts: Array.isArray(store.accounts) ? store.accounts : [], sha: f.sha };
}

async function saveAccounts(accounts, sha, message) {
  const content = seal({ accounts });
  try {
    await asService(async (token) => {
      if (sha === null && !(await branchExists(token))) return createBranch(token, content, message);
      return gh('PUT', `${R()}/contents/${CONFIG.file}`, { token, body: { message, branch: CONFIG.branch, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) } });
    });
  } catch (e) {
    if (e.github && (e.status === 409 || e.status === 422)) throw new HttpError(409, 'Someone else changed the accounts at the same moment. Please try again.', 'conflict');
    throw e;
  }
}
async function branchExists(token) {
  try { await gh('GET', `${R()}/git/ref/heads/${CONFIG.branch}`, { token }); return true; }
  catch (e) { if (e.github && e.status === 404) return false; throw e; }
}
/** First save: a branch with no history and only the account file in it. */
async function createBranch(token, content, message) {
  const blob = await gh('POST', `${R()}/git/blobs`, { token, body: { content: Buffer.from(content).toString('base64'), encoding: 'base64' } });
  const tree = await gh('POST', `${R()}/git/trees`, { token, body: { tree: [{ path: CONFIG.file, mode: '100644', type: 'blob', sha: blob.sha }] } });
  const commit = await gh('POST', `${R()}/git/commits`, { token, body: { message, tree: tree.sha, parents: [] } });
  await gh('POST', `${R()}/git/refs`, { token, body: { ref: `refs/heads/${CONFIG.branch}`, sha: commit.sha } });
}

/* ---------------- passwords ---------------- */
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return { salt: b64u(salt), hash: b64u(await scrypt(password, salt)) };
}
async function checkPassword(password, account) {
  const want = fromB64u(account.hash);
  const got = await scrypt(password, fromB64u(account.salt));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', '11111111', '00000000', 'iloveyou', 'jackstudio', 'jackstudio360', 'abcd1234', 'abc12345', 'admin123', 'letmein1']);
function passwordProblem(password, username = '') {
  const p = String(password || '');
  if (p.length < 8) return 'The password needs at least 8 characters.';
  if (p.length > 200) return 'The password is too long.';
  if (COMMON.has(p.toLowerCase())) return 'That password is too easy to guess. Choose another one.';
  if (username && p.toLowerCase() === username.toLowerCase()) return 'The password cannot be the same as the username.';
  return '';
}

/* ---------------- sessions ---------------- */
function signSession(account, days) {
  const body = b64u(JSON.stringify({ u: account.username, v: account.ver || 1, exp: now() + Math.round(days * 86400) }));
  return `${body}.${b64u(crypto.createHmac('sha256', keys().session).update(body).digest())}`;
}
function readSession(text) {
  const [body, sig] = String(text || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', keys().session).update(body).digest();
  const got = fromB64u(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const s = safe(() => JSON.parse(fromB64u(body).toString('utf8')));
  return s && s.exp > now() ? s : null;
}

const publicUser = (a) => ({ login: a.username, name: a.name || a.username, role: a.role === 'admin' ? 'admin' : 'staff', avatar: '' });
const findAccount = (accounts, username) => accounts.find((a) => a.username === String(username || '').trim().toLowerCase());

/**
 * Who is calling? Either a signed-in account (Authorization: Bearer <session>) or a repository
 * admin using their own GitHub key (X-GitHub-Token) — that is how the owner sets things up and
 * can always get back in.
 * → { user, account?, accounts?, sha?, viaGitHub }
 */
async function whoIs(req) {
  const ghKey = header(req, 'x-github-token');
  if (ghKey) {
    let me, repo;
    try {
      [me, repo] = await Promise.all([gh('GET', '/user', { token: ghKey }), gh('GET', R(), { token: ghKey })]);
    } catch (e) {
      if (e.github) throw new HttpError(401, 'Your GitHub key was not accepted. Sign in to the Studio again.', 'signed-out');
      throw e;
    }
    if (!repo.permissions || !repo.permissions.admin) throw new HttpError(403, 'Only admins can manage accounts.', 'forbidden');
    return { user: { login: me.login, name: me.name || me.login, role: 'admin', avatar: me.avatar_url || '' }, viaGitHub: true };
  }
  const auth = header(req, 'authorization') || '';
  const s = readSession(auth.replace(/^Bearer\s+/i, ''));
  if (!s) throw new HttpError(401, 'Please sign in again.', 'signed-out');
  const { accounts, sha } = await loadAccounts();
  const account = findAccount(accounts, s.u);
  // a changed password or a switched-off account ends every session of that account
  if (!account || !account.active || (account.ver || 1) !== s.v) throw new HttpError(401, 'This account was signed out. Please sign in again, or ask an admin.', 'signed-out');
  return { user: publicUser(account), account, accounts, sha, viaGitHub: false };
}

/* ---------------- slowing down password guessing ---------------- */
// Kept in memory, so it is per running copy of the service — enough to make guessing slow.
const fails = new Map(); // key → { n, until }
const LIMIT = 8, WINDOW = 15 * 60000;
function blockedFor(key) {
  const f = fails.get(key);
  if (!f) return 0;
  if (f.until < Date.now()) { fails.delete(key); return 0; }
  return f.n >= LIMIT ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
function noteFail(key) {
  const f = fails.get(key);
  if (f && f.until > Date.now()) f.n += 1;
  else fails.set(key, { n: 1, until: Date.now() + WINDOW });
  if (fails.size > 5000) fails.clear();
}
const clearFails = (key) => fails.delete(key);

/* ---------------- http ---------------- */
const header = (req, name) => { const v = req.headers && req.headers[name]; return Array.isArray(v) ? v[0] : v; };
const clientIp = (req) => String(header(req, 'x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

async function readBody(req) {
  let raw;
  try { raw = req.body; } catch { return {}; } // Vercel reads the body itself and throws here when it is not valid JSON
  if (raw === undefined) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 100000) throw new HttpError(413, 'Request too large.'); chunks.push(c); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') return raw ? (safe(() => JSON.parse(raw)) || {}) : {};
  return raw && typeof raw === 'object' ? raw : {};
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/** Wraps a function: CORS, allowed methods, and errors as { error, code }. */
function handler(methods, fn) {
  return async (req, res) => {
    // Sessions travel in a header, never in a cookie, so any page may call — only a valid session gets an answer.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-GitHub-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!methods.includes(req.method)) return send(res, 405, { error: 'Method not allowed.' });
    try {
      const out = await fn(req, res);
      if (out !== undefined) send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError && !e.github) return send(res, e.status, { error: e.message, code: e.code });
      console.error(e);
      send(res, 500, { error: e && e.github ? `GitHub answered: ${e.message}` : 'Something went wrong in the sign-in service.', code: 'error' });
    }
  };
}

module.exports = {
  CONFIG, HttpError, handler, readBody, header, clientIp,
  keys, appJwt, gh, installationId, mintToken, serviceToken,
  loadAccounts, saveAccounts, accountsFile, hashPassword, checkPassword, passwordProblem,
  signSession, readSession, whoIs, publicUser, findAccount,
  blockedFor, noteFail, clearFails,
};
