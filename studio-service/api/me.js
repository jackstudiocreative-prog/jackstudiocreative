// GET /api/me → { user } — also how the Studio checks that the account is still switched on
const core = require('./_lib/core.js');

module.exports = core.handler(['GET'], async (req) => {
  const { user, viaGitHub } = await core.whoIs(req);
  return { user, viaGitHub };
});
