// GET /api/status → is the service set up? Says what is missing in plain words, never any secret.
const core = require('./_lib/core.js');

module.exports = core.handler(['GET'], async () => {
  const checks = { key: false, app: false, installed: false, photos: false, accounts: false };
  const out = { service: 'jack-studio-360-sign-in', version: 1, repository: `${core.CONFIG.owner}/${core.CONFIG.site}`, ok: false, checks, problem: '', app: null };
  const fail = (e) => { out.problem = e instanceof core.HttpError && !e.github ? e.message : `GitHub answered: ${e.message}`; return out; };

  try { core.keys(); checks.key = true; } catch (e) { return fail(e); }

  try {
    const app = await core.gh('GET', '/app', { jwt: core.appJwt() });
    checks.app = true;
    out.app = { slug: app.slug, name: app.name };
    if (!app.permissions || app.permissions.contents !== 'write') {
      out.problem = 'The GitHub App may not change files. On GitHub, open the app’s Permissions and set “Contents” to “Read and write”.';
      return out;
    }
  } catch (e) {
    if (e.github && e.status === 401) { out.problem = 'GitHub does not accept STUDIO_KEY. Copy it again from the Studio, or create the GitHub App again.'; return out; }
    return fail(e);
  }

  try {
    const t = await core.mintToken();
    checks.installed = true;
    checks.photos = t.photos;
  } catch (e) { return fail(e); }

  try { await core.loadAccounts(); checks.accounts = true; }
  catch (e) {
    if (e.code === 'unreadable') { out.unreadable = true; out.problem = e.message; return out; }
    return fail(e);
  }

  out.ok = true;
  return out;
});
