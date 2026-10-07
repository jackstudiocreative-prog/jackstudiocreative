// POST /api/token → { token, expiresAt, photos, user }
// A GitHub key for the signed-in account that works for one hour, for the Studio's repositories only.
const core = require('./_lib/core.js');

module.exports = core.handler(['POST'], async (req) => {
  const { user, viaGitHub } = await core.whoIs(req);
  if (viaGitHub) throw new core.HttpError(400, 'You are signed in with your own GitHub key already.');
  const t = await core.mintToken();
  return { ...t, user };
});
