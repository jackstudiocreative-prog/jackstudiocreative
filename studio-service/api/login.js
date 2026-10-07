// POST /api/login { username, password, remember } → { session, user }
const core = require('./_lib/core.js');

// checked when the username does not exist, so a wrong username takes as long as a wrong password
let dummy = null;

module.exports = core.handler(['POST'], async (req) => {
  const body = await core.readBody(req);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) throw new core.HttpError(400, 'Enter your username and password.');

  const key = `${username}|${core.clientIp(req)}`;
  const wait = core.blockedFor(key);
  if (wait) throw new core.HttpError(429, `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 'slow-down');

  const { accounts } = await core.loadAccounts();
  const account = core.findAccount(accounts, username);
  dummy = dummy || await core.hashPassword('not-a-real-password');
  const ok = await core.checkPassword(password, account || dummy);
  if (!account || !ok) {
    core.noteFail(key);
    throw new core.HttpError(401, 'Wrong username or password.', 'wrong');
  }
  core.clearFails(key);
  if (!account.active) throw new core.HttpError(403, 'This account is switched off. Ask an admin to switch it on again.', 'off');
  // "keep me signed in" lasts 30 days; otherwise half a day
  return { session: core.signSession(account, body.remember ? 30 : 0.5), user: core.publicUser(account) };
});
