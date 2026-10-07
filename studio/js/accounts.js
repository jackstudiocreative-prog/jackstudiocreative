// Studio accounts: usernames and passwords an admin creates in Team, checked by the sign-in service.
// The service's address is kept in data/studio.json so the sign-in page can find it.
import { readJSON, commit, service, useService, keepSession } from './github.js';
import { SITE_BASE } from './config.js';

const SETTINGS = 'data/studio.json';
const CACHE = 'js360-service';

/** "my-app.vercel.app/anything" → "https://my-app.vercel.app"; '' when it is not an address. */
export function cleanURL(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!/^https?:\/\//i.test(t)) t = `${/^(localhost|127\.0\.0\.1)([:/]|$)/.test(t) ? 'http' : 'https'}://${t}`;
  try {
    const u = new URL(t);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (!u.hostname.includes('.') && !local) return '';
    return `${local ? u.protocol : 'https:'}//${u.host}`;
  } catch { return ''; }
}

/** The service address for the sign-in page (nobody is signed in yet, so it comes from the published site). */
export async function publicServiceURL() {
  let cached = '';
  try { cached = localStorage.getItem(CACHE) || ''; } catch {}
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${SITE_BASE}/${SETTINGS}`, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    const url = res.ok ? cleanURL((await res.json()).service) : '';
    if (res.ok || res.status === 404) {
      try { url ? localStorage.setItem(CACHE, url) : localStorage.removeItem(CACHE); } catch {}
      return url;
    }
  } catch { /* offline or slow: fall back to what worked last time */ }
  return cached;
}

/** The saved address, read straight from the repository (always current). Also points the Studio at it. */
export async function loadServiceURL() {
  const { data } = await readJSON(SETTINGS);
  const url = cleanURL(data?.service);
  useService(url);
  return url;
}

export async function saveServiceURL(url) {
  await commit({
    message: url ? 'Switch on staff accounts' : 'Switch off staff accounts',
    update: [{ path: SETTINGS, fn: (text) => `${JSON.stringify({ ...(text ? JSON.parse(text) : {}), service: url }, null, 2)}\n` }],
  });
  useService(url);
  try { url ? localStorage.setItem(CACHE, url) : localStorage.removeItem(CACHE); } catch {}
}

/** Is a service running at this address, and is it set up? → the service's own report. */
export async function checkService(url) {
  const wrong = `There is a website at ${url}, but it is not the sign-in service. On Vercel, check that Root Directory is "studio-service" (Settings → Build and Deployment), then deploy again.`;
  let report;
  try { report = await service('status', { url, anonymous: true }); }
  catch (err) { throw err.status === 404 || err.status === 405 ? new Error(wrong) : err; }
  if (report?.service !== 'jack-studio-360-sign-in') throw new Error(wrong);
  return report;
}

export const listAccounts = async () => (await service('accounts')).accounts;
export const createAccount = async (account) => (await service('accounts', { method: 'POST', body: account })).account;
export async function updateAccount(username, changes) {
  const r = await service('accounts', { method: 'PATCH', body: { username, ...changes } });
  keepSession(r.session); // set when an admin changed their own password
  return r.account;
}
export const deleteAccount = (username) => service(`accounts?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
export const resetAccounts = () => service('accounts', { method: 'POST', body: { reset: true } });

/** A password that is hard to guess and easy to read out: three groups, no look-alike characters. */
export function makePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = new Uint32Array(12);
  crypto.getRandomValues(pick);
  return [...pick].map((n, i) => (i && i % 4 === 0 ? '-' : '') + chars[n % chars.length]).join('');
}

/** The one value the service needs: the GitHub App's id and private key, as one line. */
export function makeStudioKey(id, pem) {
  const bytes = new TextEncoder().encode(JSON.stringify({ id: String(id), pem }));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
