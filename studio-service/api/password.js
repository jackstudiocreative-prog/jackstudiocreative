// POST /api/password { current, next } → { session } — a signed-in person changes their own password
const core = require('./_lib/core.js');

module.exports = core.handler(['POST'], async (req) => {
  const who = await core.whoIs(req);
  if (who.viaGitHub) throw new core.HttpError(400, 'Your password is managed on GitHub.');
  const body = await core.readBody(req);
  const key = `pw|${who.account.username}|${core.clientIp(req)}`;
  const wait = core.blockedFor(key);
  if (wait) throw new core.HttpError(429, `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 'slow-down');
  if (!(await core.checkPassword(String(body.current || ''), who.account))) {
    core.noteFail(key);
    throw new core.HttpError(403, 'Your current password is not right.', 'wrong');
  }
  core.clearFails(key);
  const problem = core.passwordProblem(body.next, who.account.username);
  if (problem) throw new core.HttpError(400, problem);

  Object.assign(who.account, await core.hashPassword(body.next), { ver: (who.account.ver || 1) + 1, updatedAt: new Date().toISOString() });
  await core.saveAccounts(who.accounts, who.sha, `Change password of ${who.account.username}`);
  // other devices are signed out; this one carries on for as long as it had left
  const old = core.readSession(String(core.header(req, 'authorization') || '').replace(/^Bearer\s+/i, ''));
  const days = Math.max(0.5, (old.exp - Date.now() / 1000) / 86400);
  return { session: core.signSession(who.account, days) };
});
