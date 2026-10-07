// Accounts, for admins only.
//   GET    /api/accounts                                   → { accounts }
//   POST   /api/accounts { username, name, role, password } → { account }       create
//   PATCH  /api/accounts { username, name?, role?, active?, password? } → { account }
//   DELETE /api/accounts?username=…                        → { ok }
//   POST   /api/accounts { reset: true }                   → { ok }  start again when the saved list cannot be read (owner's GitHub key only)
const core = require('./_lib/core.js');

const MAX = 100;
const view = (a) => ({ username: a.username, name: a.name || '', role: a.role === 'admin' ? 'admin' : 'staff', active: Boolean(a.active), createdAt: a.createdAt || null, createdBy: a.createdBy || '', updatedAt: a.updatedAt || null });
const role = (r) => (r === 'admin' ? 'admin' : 'staff');
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

module.exports = core.handler(['GET', 'POST', 'PATCH', 'DELETE'], async (req) => {
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await core.readBody(req);

  const who = await core.whoIs(req);
  if (who.user.role !== 'admin') throw new core.HttpError(403, 'Only admins can manage accounts.', 'forbidden');

  if (req.method === 'POST' && body.reset === true) {
    if (!who.viaGitHub) throw new core.HttpError(403, 'Only the owner, signed in with a GitHub key, can start the accounts again.', 'forbidden');
    let sha = null;
    try { sha = (await core.loadAccounts()).sha; }
    catch (e) { if (e.code !== 'unreadable') throw e; sha = ((await core.accountsFile()) || {}).sha || null; }
    await core.saveAccounts([], sha, 'Start the accounts again');
    return { ok: true };
  }

  const { accounts, sha } = who.accounts ? who : await core.loadAccounts();
  const me = who.viaGitHub ? null : who.account.username;
  const stamp = new Date().toISOString();

  if (req.method === 'GET') return { accounts: accounts.map(view) };

  if (req.method === 'POST') {
    const username = String(body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new core.HttpError(400, 'A username is 3–30 characters: small letters, numbers, dot, dash or underscore, starting with a letter or number.');
    if (username === core.CONFIG.owner.toLowerCase()) throw new core.HttpError(400, 'That username belongs to the owner’s GitHub account. Choose another one.');
    if (core.findAccount(accounts, username)) throw new core.HttpError(409, `There is already an account called "${username}".`);
    if (accounts.length >= MAX) throw new core.HttpError(400, `There can be at most ${MAX} accounts.`);
    const problem = core.passwordProblem(body.password, username);
    if (problem) throw new core.HttpError(400, problem);
    const account = { username, name: cleanName(body.name) || username, role: role(body.role), active: true, ...(await core.hashPassword(body.password)), ver: 1, createdAt: stamp, createdBy: who.user.login, updatedAt: stamp };
    accounts.push(account);
    await core.saveAccounts(accounts, sha, `Add account ${username}`);
    return { account: view(account) };
  }

  const username = String((req.method === 'DELETE' ? query(req).username : body.username) || '').trim().toLowerCase();
  const account = core.findAccount(accounts, username);
  if (!account) throw new core.HttpError(404, 'That account no longer exists.');

  if (req.method === 'DELETE') {
    if (username === me) throw new core.HttpError(400, 'You cannot delete the account you are signed in with.');
    accounts.splice(accounts.indexOf(account), 1);
    await core.saveAccounts(accounts, sha, `Delete account ${username}`);
    return { ok: true };
  }

  // PATCH
  if (username === me && (body.active === false || (body.role && role(body.role) !== 'admin'))) {
    throw new core.HttpError(400, 'You cannot switch off or demote the account you are signed in with.');
  }
  if (body.name !== undefined) account.name = cleanName(body.name) || account.username;
  if (body.role !== undefined) account.role = role(body.role);
  if (body.active !== undefined && Boolean(body.active) !== Boolean(account.active)) {
    account.active = Boolean(body.active);
    account.ver = (account.ver || 1) + 1; // ends the sessions of an account that is switched off
  }
  if (body.password !== undefined) {
    const problem = core.passwordProblem(body.password, username);
    if (problem) throw new core.HttpError(400, problem);
    Object.assign(account, await core.hashPassword(body.password));
    account.ver = (account.ver || 1) + 1; // a new password signs the account out everywhere
  }
  account.updatedAt = stamp;
  await core.saveAccounts(accounts, sha, `Update account ${username}`);
  // an admin who changed their own password stays signed in on this device
  const session = username === me && body.password !== undefined ? core.signSession(account, 30) : undefined;
  return { account: view(account), session };
});

function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}
