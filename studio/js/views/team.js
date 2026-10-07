// Team — account management (admins only)
//  · Staff accounts: usernames and passwords an admin creates here (checked by the sign-in service).
//    The owner sets the service up once, with the steps on this page.
//  · GitHub members: people who sign in with their own GitHub key (shown to those signed in that way).
import { listTeam, inviteMember, removeMember, cancelInvite, syncPhotoAccess, signedInWith, claimGitHubApp } from '../github.js';
import {
  loadServiceURL, saveServiceURL, checkService, cleanURL, listAccounts, createAccount, updateAccount, deleteAccount,
  resetAccounts, makePassword, makeStudioKey,
} from '../accounts.js';
import { REPO, PHOTOS_REPO, SITE_BASE } from '../config.js';
import { esc, toast, busy, timeAgo, copyText, slugify } from '../ui.js';

const ROLE = { admin: 'Admin', staff: 'Staff', viewer: 'View only' };
const SETUP = 'js360-setup';         // what the set-up steps have produced so far (this browser tab only)
const RETURN = 'js360-setup-return'; // what GitHub sent back (see app.js)
const APP_NAME = 'Jack Studio 360 Sign-in';
const studioURL = () => `${location.origin}${location.pathname}`;
const store = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export async function render(el, { user }) {
  const viaGitHub = signedInWith() === 'github';
  el.innerHTML = `
    <div class="page-head lib-head">
      <div><h1>Team</h1><p class="ws-sub">Create accounts for your staff and choose what they can do.</p></div>
    </div>
    <section class="team-block" id="accounts"><div class="loading">Loading accounts…</div></section>
    ${viaGitHub ? '<section class="team-block" id="github"><div class="loading">Loading GitHub members…</div></section>' : ''}`;

  const tasks = [staffAccounts(el.querySelector('#accounts'), { user, viaGitHub })];
  if (viaGitHub) {
    tasks.push(githubMembers(el.querySelector('#github'), { user }).catch((err) => {
      el.querySelector('#github').innerHTML = `<h2 class="team-h">GitHub members</h2><div class="empty">${esc(err.message)}</div>`;
    }));
  }
  await Promise.all(tasks);
  return {};
}

/* ================= Staff accounts ================= */

async function staffAccounts(host, ctx) {
  const again = () => staffAccounts(host, ctx);
  const url = await loadServiceURL();
  if (!url) {
    if (ctx.viaGitHub) return setupSteps(host, { ...ctx, again });
    host.innerHTML = '<h2 class="team-h">Staff accounts</h2><div class="empty">Staff accounts are not switched on.</div>';
    return;
  }
  let accounts;
  try { accounts = await listAccounts(); }
  catch (err) {
    if (err.status === 401 && !ctx.viaGitHub) throw err; // this account was signed out — the Studio shows the sign-in page
    return trouble(host, { ...ctx, url, err, again });
  }
  accountList(host, { ...ctx, url, accounts, again });
}

function accountList(host, { user, viaGitHub, url, accounts, again, handover = null }) {
  const me = viaGitHub ? '' : user.login;
  accounts.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  host.innerHTML = `
    <h2 class="team-h">Staff accounts <span class="status">${accounts.length}</span></h2>
    <div class="editor">
      <section class="panel">
        ${handover ? handoverBox(handover) : ''}
        <h2>Accounts</h2>
        <p class="sub"><b>Admins</b> can do everything, including managing accounts. <b>Staff</b> can create, edit and publish projects.</p>
        ${accounts.length ? `<ul class="members acct-list">${accounts.map((a) => `
          <li data-user="${esc(a.username)}" class="${a.active ? '' : 'is-off'}">
            <span class="avatar-ph acct-avatar" aria-hidden="true">${esc((a.name || a.username).trim().charAt(0).toUpperCase())}</span>
            <div class="grow">
              <b>${esc(a.name)}</b>${a.username === me ? ' <span class="status">(you)</span>' : ''}${a.active ? '' : ' <span class="badge badge--muted">Switched off</span>'}
              <span class="acct-user">${esc(a.username)}${a.createdAt ? ` · added ${timeAgo(a.createdAt)}` : ''}</span>
            </div>
            ${a.username === me
              ? `<span class="badge">${ROLE[a.role]}</span><a class="link-btn" href="#/account">Change my password</a>`
              : `<select class="select select--sm" data-role aria-label="Role for ${esc(a.name)}">
                   <option value="staff" ${a.role === 'staff' ? 'selected' : ''}>Staff</option>
                   <option value="admin" ${a.role === 'admin' ? 'selected' : ''}>Admin</option>
                 </select>
                 <button class="link-btn" type="button" data-reset>Reset password</button>
                 <button class="link-btn" type="button" data-active="${a.active ? 'off' : 'on'}">${a.active ? 'Switch off' : 'Switch on'}</button>
                 <button class="link-btn danger" type="button" data-delete>Delete</button>`}
            <form class="acct-reset" hidden>
              <label class="label" for="np-${esc(a.username)}">New password for ${esc(a.name)}</label>
              <div class="acct-pw">
                <input class="input" id="np-${esc(a.username)}" name="password" autocomplete="off" spellcheck="false" minlength="8" required>
                <button class="btn btn--ghost btn--sm" type="button" data-generate>Generate</button>
              </div>
              <div class="acct-pw">
                <button class="btn btn--sm" type="submit">Save new password</button>
                <button class="link-btn" type="button" data-cancel>Cancel</button>
              </div>
            </form>
          </li>`).join('')}</ul>`
        : '<div class="empty">No accounts yet. Add the first one on the right.</div>'}
      </section>

      <section class="panel">
        <h2>Add an account</h2>
        <p class="sub">You choose the username and password and pass them on. No GitHub account or email is needed.</p>
        <form id="add" novalidate>
          <div class="field"><label for="a-name">Name</label><input class="input" id="a-name" maxlength="60" autocomplete="off" placeholder="e.g. Aina Rahman" required></div>
          <div class="field"><label for="a-user">Username</label><input class="input" id="a-user" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. aina" required>
            <span class="hint">3–30 characters: small letters, numbers, dot, dash or underscore.</span></div>
          <div class="field"><label for="a-role">Role</label>
            <select class="select" id="a-role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
          <div class="field"><label for="a-pass">Password</label>
            <div class="acct-pw">
              <input class="input" id="a-pass" autocomplete="off" spellcheck="false" minlength="8" required>
              <button class="btn btn--ghost btn--sm" type="button" id="a-generate">Generate</button>
            </div>
            <span class="hint">At least 8 characters. They can change it after signing in.</span></div>
          <p class="error" id="a-error" role="alert"></p>
          <button class="btn" type="submit" id="a-save">Create account</button>
        </form>
      </section>
    </div>
    ${viaGitHub ? `<details class="team-more" id="svc"><summary>Sign-in service</summary>${serviceBox(url)}</details>` : ''}`;

  const $ = (s) => host.querySelector(s);
  const redraw = (next, h = null) => accountList(host, { user, viaGitHub, url, accounts: next, again, handover: h });
  const swap = (a) => accounts.map((x) => (x.username === a.username ? a : x));
  bindHandover(host);
  if (viaGitHub) bindServiceBox($('#svc'), { url, again });

  /* add */
  $('#a-pass').value = makePassword();
  $('#a-generate').addEventListener('click', () => { $('#a-pass').value = makePassword(); });
  let typedUser = false;
  $('#a-user').addEventListener('input', () => { typedUser = true; });
  $('#a-name').addEventListener('input', () => {
    if (typedUser) return;
    const first = slugify($('#a-name').value.trim().split(/\s+/)[0] || '');
    $('#a-user').value = first.length >= 3 ? first : slugify($('#a-name').value).replace(/-/g, '.');
  });
  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    const fail = (t) => { $('#a-error').textContent = t; };
    const account = { name: $('#a-name').value.trim(), username: $('#a-user').value.trim().toLowerCase(), role: $('#a-role').value, password: $('#a-pass').value };
    fail('');
    if (!account.name) return fail('Enter the person’s name.');
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(account.username)) return fail('A username is 3–30 characters: small letters, numbers, dot, dash or underscore.');
    if (account.password.length < 8) return fail('The password needs at least 8 characters.');
    busy($('#a-save'), 'Creating…', async () => {
      try {
        const made = await createAccount(account);
        toast(`Account for ${made.name} created`);
        redraw([...accounts, made], { title: 'Account ready', name: made.name, username: made.username, password: account.password });
      } catch (err) { fail(err.message); }
    });
  });

  /* each account */
  host.querySelectorAll('[data-user]').forEach((li) => {
    const a = accounts.find((x) => x.username === li.dataset.user);
    const change = async (changes, done) => {
      try { const next = await updateAccount(a.username, changes); done?.(next); return next; }
      catch (err) { toast(err.message, true); return null; }
    };
    li.querySelector('[data-role]')?.addEventListener('change', async (e) => {
      const next = await change({ role: e.target.value });
      if (next) toast(`${next.name} is now ${ROLE[next.role]}`);
      redraw(next ? swap(next) : accounts);
    });
    li.querySelector('[data-active]')?.addEventListener('click', (e) => {
      const off = e.currentTarget.dataset.active === 'off';
      if (off && !confirm(`Switch off ${a.name}'s account? They are signed out within an hour and cannot sign in until you switch it on again.`)) return;
      busy(e.currentTarget, 'Saving…', async () => {
        const next = await change({ active: !off });
        if (next) { toast(off ? `${next.name}'s account is switched off` : `${next.name} can sign in again`); redraw(swap(next)); }
      });
    });
    li.querySelector('[data-delete]')?.addEventListener('click', (e) => {
      if (!confirm(`Delete ${a.name}'s account? Their projects stay. This cannot be undone.`)) return;
      busy(e.currentTarget, 'Deleting…', async () => {
        try { await deleteAccount(a.username); toast('Account deleted'); redraw(accounts.filter((x) => x.username !== a.username)); }
        catch (err) { toast(err.message, true); }
      });
    });
    const form = li.querySelector('.acct-reset');
    li.querySelector('[data-reset]')?.addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) { form.password.value = makePassword(); form.password.focus(); }
    });
    form.querySelector('[data-generate]').addEventListener('click', () => { form.password.value = makePassword(); });
    form.querySelector('[data-cancel]').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const password = form.password.value;
      if (password.length < 8) { toast('The password needs at least 8 characters.', true); return; }
      busy(form.querySelector('[type=submit]'), 'Saving…', async () => {
        const next = await change({ password });
        if (next) redraw(swap(next), { title: 'New password saved', name: next.name, username: next.username, password });
      });
    });
  });
}

/** Shown once after creating an account or resetting a password: what to pass on to the person. */
function handoverBox({ title, name, username, password }) {
  const text = `Jack Studio 360° Studio\n${studioURL()}\nUsername: ${username}\nPassword: ${password}`;
  return `
    <div class="handover" role="status">
      <b>${esc(title)} — give these sign-in details to ${esc(name)}</b>
      <dl>
        <dt>Studio</dt><dd>${esc(studioURL())}</dd>
        <dt>Username</dt><dd>${esc(username)}</dd>
        <dt>Password</dt><dd><code>${esc(password)}</code></dd>
      </dl>
      <div class="acct-pw">
        <button class="btn btn--sm" type="button" data-copy="${esc(text)}">Copy sign-in details</button>
        <button class="link-btn" type="button" data-dismiss>Done</button>
      </div>
      <p class="hint">The password is not shown again. ${esc(name)} can change it after signing in, under their name at the top right.</p>
    </div>`;
}
function bindHandover(host) {
  const box = host.querySelector('.handover');
  if (!box) return;
  box.querySelector('[data-copy]').addEventListener('click', (e) => copyText(e.currentTarget.dataset.copy, e.currentTarget));
  box.querySelector('[data-dismiss]').addEventListener('click', () => box.remove());
}

/** The accounts could not be loaded. Say why, and let the owner fix it. */
function trouble(host, { viaGitHub, url, err, again }) {
  const unreadable = err.code === 'unreadable';
  host.innerHTML = `
    <h2 class="team-h">Staff accounts</h2>
    <section class="panel">
      <h2>${unreadable ? 'The saved accounts cannot be read' : 'The accounts could not be loaded'}</h2>
      <p class="sub">${esc(err.message)}</p>
      ${unreadable ? `<p class="sub">This happens when the GitHub App was created again, or <code>STUDIO_KEY</code> was changed on Vercel. Put the earlier <code>STUDIO_KEY</code> back, or start again with no accounts and create them anew.</p>` : ''}
      <div class="acct-pw">
        <button class="btn btn--ghost btn--sm" type="button" id="retry">Try again</button>
        ${unreadable && viaGitHub ? '<button class="btn btn--danger btn--sm" type="button" id="wipe">Start again with no accounts</button>' : ''}
      </div>
      ${viaGitHub ? `<div class="team-svc">${serviceBox(url)}</div>` : '<p class="sub" style="margin-top:14px">Ask the owner to open Team and check the sign-in service.</p>'}
    </section>`;
  host.querySelector('#retry').addEventListener('click', (e) => busy(e.currentTarget, 'Checking…', again));
  host.querySelector('#wipe')?.addEventListener('click', (e) => {
    if (!confirm('Start again with no accounts? Everyone with a staff account has to be added again.')) return;
    busy(e.currentTarget, 'Starting again…', async () => {
      try { await resetAccounts(); toast('Accounts cleared'); await again(); } catch (e2) { toast(e2.message, true); }
    });
  });
  if (viaGitHub) bindServiceBox(host.querySelector('.team-svc'), { url, again });
}

/* ---------- the service's address: check it, change it ---------- */

function serviceBox(url) {
  return `
    <p class="sub">Staff accounts are checked by your sign-in service on Vercel. It only works for this Studio.</p>
    <div class="field">
      <label for="svc-url">Address of the service</label>
      <div class="acct-pw">
        <input class="input" id="svc-url" value="${esc(url)}" inputmode="url" autocomplete="off" spellcheck="false" placeholder="e.g. jackstudiocreative.vercel.app">
        <button class="btn btn--ghost btn--sm" type="button" id="svc-check">Check</button>
      </div>
    </div>
    <div id="svc-report" aria-live="polite"></div>
    <button class="btn btn--sm" type="button" id="svc-save" hidden>Save this address</button>`;
}

const TICKS = [
  ['key', 'STUDIO_KEY is in place'],
  ['app', 'GitHub accepts it'],
  ['installed', 'The GitHub App is installed on the website repository'],
  ['accounts', 'Accounts can be saved'],
];
function reportHTML(report) {
  return `
    <ul class="checks">
      ${TICKS.map(([k, label]) => `<li class="${report.checks[k] ? 'is-ok' : 'is-no'}">${label}</li>`).join('')}
      <li class="${report.checks.photos ? 'is-ok' : 'is-opt'}">${report.checks.photos ? 'The photo library is connected' : `Photo library not connected (only needed for Product Library → Photos: add <b>${esc(PHOTOS_REPO)}</b> to the GitHub App’s repositories)`}</li>
    </ul>
    ${report.ok ? '<p class="checks-ok">Everything is ready.</p>' : `<p class="error">${esc(report.problem || 'The service is not ready yet.')}</p>`}`;
}

/** Wires up a serviceBox: Check asks the service how it is doing; a working address that differs from the saved one can be saved. */
function bindServiceBox(box, { url, again }) {
  const $ = (s) => box.querySelector(s);
  let checked = '';
  const check = () => busy($('#svc-check'), 'Checking…', async () => {
    const target = cleanURL($('#svc-url').value);
    $('#svc-save').hidden = true;
    if (!target) { $('#svc-report').innerHTML = '<p class="error">Paste the address Vercel shows under Domains, for example jackstudiocreative.vercel.app.</p>'; return; }
    $('#svc-url').value = target;
    try {
      const report = await checkService(target);
      $('#svc-report').innerHTML = reportHTML(report);
      checked = report.ok || report.unreadable ? target : '';
      $('#svc-save').hidden = !checked || target === url;
    } catch (err) {
      $('#svc-report').innerHTML = `<p class="error">${esc(err.status === 0 ? `Nothing answers at ${target}. Check the address, and that the deployment on Vercel has finished.` : err.message)}</p>`;
    }
  });
  $('#svc-check').addEventListener('click', check);
  $('#svc-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  $('#svc-url').addEventListener('input', () => { $('#svc-save').hidden = true; });
  $('#svc-save').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
    try {
      await saveServiceURL(checked);
      store.set(SETUP, null); // the private key is no longer needed in this browser
      toast('Staff accounts are switched on');
      await again();
    } catch (err) { toast(err.message, true); }
  }));
}

/* ---------- setting up, once (owner, signed in with a GitHub key) ---------- */

async function setupSteps(host, { again }) {
  let setup = store.get(SETUP) || {};
  let notice = '';

  // back from GitHub?
  const back = store.get(RETURN);
  if (back) {
    store.set(RETURN, null);
    if (back.code) {
      if (!setup.state || back.state !== setup.state) notice = 'GitHub sent you back, but not to the browser tab the set-up was started in. Press the button in step 1 again.';
      else {
        try {
          const app = await claimGitHubApp(back.code);
          setup = { ...setup, app: { id: app.id, slug: app.slug, name: app.name, key: makeStudioKey(app.id, app.pem) } };
        } catch (err) { notice = err.message; }
      }
    }
    if (back.installed) setup.installed = true;
    store.set(SETUP, setup);
  }

  const app = setup.app;
  const step = !app ? 1 : !setup.installed ? 2 : 3;
  const cls = (n) => (n < step ? 'is-done' : n === step || (step === 3 && n === 4) ? 'is-now' : ''); // steps 3 and 4 are done together
  const manifest = {
    name: APP_NAME,
    url: `${SITE_BASE}/`,
    description: 'Lets the Jack Studio 360 Studio sign staff in with a username and password.',
    hook_attributes: { url: `${SITE_BASE}/`, active: false },
    redirect_url: studioURL(),
    setup_url: studioURL(),
    public: false,
    default_permissions: { contents: 'write', pages: 'read' },
    default_events: [],
  };

  host.innerHTML = `
    <h2 class="team-h">Staff accounts</h2>
    <section class="panel setup">
      <h2>Switch on staff accounts</h2>
      <p class="sub">Create accounts with a username and password for your staff — they don’t need GitHub. This is set up once, in four steps (about 15 minutes). You need to be signed in to GitHub in this browser as <b>${esc(REPO.owner)}</b>.</p>
      ${notice ? `<p class="error" role="alert">${esc(notice)}</p>` : ''}
      <ol class="setup-steps">
        <li class="${cls(1)}">
          <h3>Create the connection to GitHub</h3>
          ${app ? `<p class="setup-done">Created${app.name ? `: <b>${esc(app.name)}</b>` : ''}.</p>` : `
          <p>The service needs its own way into GitHub (a “GitHub App”), so that no personal key is shared. Press the button; GitHub opens with everything filled in. Press the green <b>Create GitHub App</b> button there and you come straight back here.</p>
          <form id="create" method="post" action="https://github.com/settings/apps/new">
            <input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}">
            <button class="btn" type="submit">Create the GitHub App ↗</button>
          </form>
          <p class="hint">If GitHub says the name is taken, change it a little on that page (for example add “JS”).</p>
          <details class="setup-manual"><summary>The button doesn’t work? Do this step by hand</summary>
            <ol>
              <li>On GitHub: your picture → <b>Settings</b> → <b>Developer settings</b> → <b>GitHub Apps</b> → <b>New GitHub App</b>.</li>
              <li>Name: <b>${APP_NAME}</b>. Homepage URL: <code>${esc(SITE_BASE)}/</code>. Under Webhook, untick <b>Active</b>.</li>
              <li>Repository permissions → <b>Contents: Read and write</b>. Choose <b>Only on this account</b>, then <b>Create GitHub App</b>.</li>
              <li>Note the <b>App ID</b>. Further down, press <b>Generate a private key</b> — a <code>.pem</code> file downloads.</li>
            </ol>
            <div class="field"><label for="m-id">App ID</label><input class="input" id="m-id" inputmode="numeric" autocomplete="off"></div>
            <div class="field"><label for="m-pem">Private key file (.pem)</label><input id="m-pem" type="file" accept=".pem,.txt"></div>
            <button class="btn btn--ghost btn--sm" type="button" id="m-make">Use these</button>
          </details>`}
        </li>
        <li class="${cls(2)}">
          <h3>Install it on your repository</h3>
          <p>On GitHub choose <b>Only select repositories</b>, pick <b>${esc(REPO.repo)}</b> (and <b>${esc(PHOTOS_REPO)}</b> too, if you use the photo library), then press <b>Install</b>. You come back here afterwards.</p>
          ${app ? (app.slug
            ? `<a class="btn ${step === 2 ? '' : 'btn--ghost'}" href="https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new">Install on GitHub ↗</a>`
            : '<p>On the app’s page on GitHub, choose <b>Install App</b> in the menu on the left.</p>')
            : '<p class="hint">Finish step 1 first.</p>'}
          ${app && !setup.installed ? '<p><button class="link-btn" type="button" id="installed">I have installed it</button></p>' : ''}
          ${setup.installed ? '<p class="setup-done">Installed.</p>' : ''}
        </li>
        <li class="${cls(3)}">
          <h3>Put the service on Vercel</h3>
          ${app ? `
          <ol>
            <li>Open <a href="https://vercel.com/new" target="_blank" rel="noopener">vercel.com/new ↗</a> and choose <b>Continue with GitHub</b>. If Vercel asks to be installed on GitHub, allow it for <b>${esc(REPO.repo)}</b>.</li>
            <li>Next to <b>${esc(REPO.repo)}</b>, press <b>Import</b>.</li>
            <li>At <b>Root Directory</b> press <b>Edit</b> and choose the folder <b>studio-service</b>.</li>
            <li>Open <b>Environment Variables</b> and add one:
              <div class="setup-env">
                <span>Key</span><code>STUDIO_KEY</code><button class="btn btn--ghost btn--sm" type="button" data-copy="STUDIO_KEY">Copy</button>
                <span>Value</span><code>••••••••••••  (${app.key.length} characters)</code><button class="btn btn--sm" type="button" data-copy="${esc(app.key)}">Copy value</button>
              </div>
            </li>
            <li>Press <b>Deploy</b> and wait about a minute.</li>
            <li>Open the project and copy its address under <b>Domains</b> — it ends in <code>.vercel.app</code>.</li>
          </ol>
          <p class="hint">The value is a secret that only exists in this browser tab: keep the tab open until step 4 is done, and don’t send the value to anyone.</p>`
          : '<p class="hint">Finish step 1 first.</p>'}
        </li>
        <li class="${cls(4)}">
          <h3>Tell the Studio where the service is</h3>
          <p>Paste the address from Vercel and press <b>Check</b>. When everything is ticked, save it — after that you can add accounts here.</p>
          <div class="team-svc">${serviceBox('')}</div>
        </li>
      </ol>
      ${app ? '<p><button class="link-btn danger" type="button" id="restart">Start the set-up again</button></p>' : ''}
    </section>`;

  const $ = (s) => host.querySelector(s);
  const save = (next) => { setup = next; store.set(SETUP, setup); return setupSteps(host, { again }); };

  $('#create')?.addEventListener('submit', (e) => {
    // GitHub sends this value back, which proves the answer belongs to this browser tab
    const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    store.set(SETUP, { ...setup, state });
    e.target.action = `https://github.com/settings/apps/new?state=${state}`;
  });
  $('#m-make')?.addEventListener('click', async () => {
    const id = $('#m-id').value.trim(), file = $('#m-pem').files[0];
    if (!/^\d+$/.test(id)) { toast('Enter the App ID (a number).', true); return; }
    if (!file) { toast('Choose the .pem file GitHub downloaded.', true); return; }
    const pem = await file.text();
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) { toast('That file is not a private key.', true); return; }
    save({ ...setup, app: { id, slug: '', name: '', key: makeStudioKey(id, pem) } });
  });
  $('#installed')?.addEventListener('click', () => save({ ...setup, installed: true }));
  $('#restart')?.addEventListener('click', () => {
    if (confirm('Start again? You will create a new GitHub App; the one made before can be deleted on GitHub (Settings → Developer settings → GitHub Apps).')) save({});
  });
  host.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, b)));
  const svc = host.querySelector('.team-svc');
  if (svc) bindServiceBox(svc, { url: '', again });
}

/* ================= GitHub members ================= */

async function githubMembers(host, { user }) {
  const team = await listTeam();
  host.innerHTML = `
    <h2 class="team-h">GitHub members <span class="status">${team.members.length}</span></h2>
    <p class="team-sub">People who sign in with their own GitHub key. You are one of them — keep it that way: it is how you get in if the sign-in service ever stops.</p>
    <div class="editor">
      <section class="panel">
        <h2>Members</h2>
        <p class="sub"><b>Admins</b> can do everything, including managing the team. <b>Staff</b> can create, edit and publish projects.</p>
        <ul class="members">${team.members.map((m) => `
          <li>
            ${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : '<span class="avatar-ph"></span>'}
            <div class="grow"><b>${esc(m.login)}</b>${m.login === user.login ? ' <span class="status">(you)</span>' : ''}${m.owner ? ' <span class="status">· owner</span>' : ''}</div>
            ${m.owner || m.login === user.login
              ? `<span class="badge">${ROLE[m.role]}</span>`
              : `<select class="select select--sm" data-role="${esc(m.login)}" aria-label="Role for ${esc(m.login)}">
                   <option value="staff" ${m.role === 'staff' ? 'selected' : ''}>Staff</option>
                   <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
                 </select>
                 <button class="link-btn danger" type="button" data-remove="${esc(m.login)}">Remove</button>`}
          </li>`).join('')}</ul>

        ${team.invites.length ? `<h2 style="margin-top:20px">Waiting to accept</h2>
        <ul class="members">${team.invites.map((i) => `
          <li><span class="avatar-ph"></span><div class="grow"><b>${esc(i.login)}</b> <span class="status">invited ${timeAgo(i.created)}</span></div>
            <span class="badge badge--muted">${ROLE[i.role]}</span>
            <button class="link-btn danger" type="button" data-cancel="${i.id}">Cancel</button></li>`).join('')}</ul>` : ''}
      </section>

      <div>
      <section class="panel">
        <h2>Invite a GitHub member</h2>
        <p class="sub">They need a free GitHub account. GitHub emails them an invitation; after accepting, they sign in to the Studio with their own access key.</p>
        <form id="invite">
          <div class="field"><label for="login">GitHub username</label><input class="input" id="login" autocomplete="off" spellcheck="false" placeholder="e.g. amy-jackstudio"></div>
          <div class="field"><label for="role">Role</label>
            <select class="select" id="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
          <button class="btn" type="submit" id="send">Send invitation</button>
        </form>
        <p class="status" style="margin-top:16px">Access is managed through the GitHub repositories <b>${esc(REPO.owner)}/${esc(REPO.repo)}</b> (website) and <b>${esc(PHOTOS_REPO)}</b> (private photos). New members get an invitation email for each — they need to accept both.</p>
      </section>
      <section class="panel">
        <h2>Photo library access</h2>
        <p class="sub">If a GitHub member can't open <b>Product Library → Photos</b>, this re-sends their photo library invitation with the same role they have here.</p>
        <button class="btn btn--ghost btn--sm" type="button" id="sync">Give everyone photo access</button>
      </section>
      </div>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const reload = () => githubMembers(host, { user });

  $('#invite').addEventListener('submit', (e) => {
    e.preventDefault();
    const login = $('#login').value.trim().replace(/^@/, '');
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login)) { toast('Enter a valid GitHub username', true); return; }
    busy($('#send'), 'Sending…', async () => {
      try {
        await inviteMember(login, $('#role').value);
        toast(`Invitation sent to ${login}`);
        reload();
      } catch (err) { toast(err.status === 404 ? `No GitHub user called "${login}"` : err.message, true); }
    });
  });

  $('#sync').addEventListener('click', (e) => busy(e.currentTarget, 'Updating…', async () => {
    try { await syncPhotoAccess(); toast('Photo library access updated'); }
    catch (err) { toast(err.status === 404 ? 'The photo library is not set up yet (Product Library → Photos).' : err.message, true); }
  }));

  host.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => {
    try { await inviteMember(s.dataset.role, s.value); toast(`${s.dataset.role} is now ${ROLE[s.value]}`); }
    catch (err) { toast(err.message, true); reload(); }
  }));
  host.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(`Remove ${b.dataset.remove}? They lose access to the Studio immediately.`)) return;
    busy(b, 'Removing…', async () => {
      try { await removeMember(b.dataset.remove); toast('Removed'); reload(); } catch (err) { toast(err.message, true); }
    });
  }));
  host.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => busy(b, 'Cancelling…', async () => {
    try { await cancelInvite(b.dataset.cancel); toast('Invitation cancelled'); reload(); } catch (err) { toast(err.message, true); }
  })));
}
