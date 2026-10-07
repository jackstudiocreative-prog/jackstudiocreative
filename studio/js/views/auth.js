// Login & reset password (diagram: Login → Failed → Home page / Forgot password → Reset → Login)
// With staff accounts switched on, people sign in with a username and password;
// signing in with a personal GitHub key stays available (the owner uses it).
import { setToken, whoAmI, signIn } from '../github.js';
import { publicServiceURL } from '../accounts.js';
import { REPO } from '../config.js';
import { esc } from '../ui.js';

const NEW_KEY_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Jack%20Studio%20360%20Studio';
const card = (inner) => `
    <form class="auth-card" id="login-form" novalidate>
      <a class="brand" href="../">JACK STUDIO <span>360°</span></a>
      <h1>Sign in</h1>
      <p class="sub">The internal workspace for creating 360° products and showrooms.</p>
      ${inner}
    </form>`;
const foot = (message) => `
      <label class="check"><input type="checkbox" id="remember" checked> Keep me signed in on this device</label>
      <p class="error" id="login-error" role="alert">${esc(message)}</p>
      <div class="auth-failed" id="failed" ${message ? '' : 'hidden'}>
        <a href="../">← Back to home page</a>
      </div>
      <button class="btn" type="submit" id="submit">Sign in</button>`;

export async function render(el, { mode = 'login', message = '', onSignedIn }) {
  el.innerHTML = '<div class="auth-card"><a class="brand" href="../">JACK STUDIO <span>360°</span></a><p class="sub">Loading…</p></div>';
  const service = await publicServiceURL(); // '' until an admin has switched on staff accounts
  if (mode === 'forgot') return renderForgot(el, service);
  if (service) renderAccount(el, { service, message, onSignedIn });
  else renderKey(el, { service, message, onSignedIn });
}

/** Username + password, checked by the sign-in service. */
function renderAccount(el, { service, message, onSignedIn }) {
  el.innerHTML = card(`
      <div class="field">
        <label for="username">Username</label>
        <input class="input" id="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input class="input" id="password" type="password" autocomplete="current-password" required>
      </div>
      ${foot(message)}
      <p class="auth-links"><a href="#/forgot">Forgot your password?</a> · <button class="link-btn" type="button" id="use-key">Use a GitHub key instead</button></p>`);

  const $ = (s) => el.querySelector(s);
  $('#use-key').addEventListener('click', () => renderKey(el, { service, message: '', onSignedIn }));
  $('#username').focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username').value.trim(), password = $('#password').value;
    $('#login-error').textContent = '';
    if (!username || !password) { $('#login-error').textContent = 'Enter your username and password.'; return; }
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      onSignedIn(await signIn(service, username, password, $('#remember').checked));
    } catch (err) {
      $('#login-error').textContent = err.message;
      $('#failed').hidden = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
      $('#password').select();
    }
  });
}

/** A personal GitHub access key. */
function renderKey(el, { service, message, onSignedIn }) {
  el.innerHTML = card(`
      <div class="field">
        <label for="key">GitHub access key</label>
        <input class="input" id="key" type="password" autocomplete="current-password" spellcheck="false" placeholder="ghp_…" required>
        <span class="hint">Your personal key from GitHub. <button class="link-btn" type="button" id="how">How do I get one?</button></span>
      </div>

      <div class="help" id="help" hidden>
        <ol>
          <li>Sign in to <b>GitHub</b> with your own account (an admin must have invited you).</li>
          <li>Open <a href="${NEW_KEY_URL}" target="_blank" rel="noopener">New access key</a>. The name and the <b>repo</b> permission are already filled in.</li>
          <li>Choose an expiry (for example 90 days), then press <b>Generate token</b>.</li>
          <li>Copy the key that starts with <code>ghp_</code> and paste it above.</li>
        </ol>
      </div>
      ${foot(message)}
      <p class="auth-links">${service
        ? '<button class="link-btn" type="button" id="use-account">Sign in with a username and password</button>'
        : '<a href="#/forgot">Forgot your password or key?</a>'}</p>`);

  const $ = (s) => el.querySelector(s);
  $('#use-account')?.addEventListener('click', () => renderAccount(el, { service, message: '', onSignedIn }));
  $('#how').addEventListener('click', () => { $('#help').hidden = !$('#help').hidden; });
  $('#key').focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#key').value.trim();
    $('#login-error').textContent = '';
    if (!key) { $('#login-error').textContent = 'Paste your GitHub access key.'; return; }
    if (!/^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})$/.test(key)) {
      $('#login-error').textContent = `That doesn't look like a complete GitHub key (${key.length} characters). A key starts with "ghp_" and is 40 characters long — copy it with the copy icon on GitHub and paste it here.`;
      return;
    }
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    setToken(key, $('#remember').checked);
    try {
      onSignedIn(await whoAmI());
    } catch (err) {
      setToken(null);
      $('#login-error').textContent = err.message;
      $('#failed').hidden = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function renderForgot(el, service) {
  el.innerHTML = `
    <div class="auth-card">
      <a class="brand" href="../">JACK STUDIO <span>360°</span></a>
      <h1>Reset access</h1>
      ${service ? `
      <p class="sub">Ask a Studio admin for a new password.</p>
      <div class="help">
        <p><b>Forgot your password?</b></p>
        <ol>
          <li>Tell an admin. They open <b>Team</b>, find your account and press <b>Reset password</b>.</li>
          <li>Sign in with the new password they give you.</li>
          <li>Then choose your own under your name at the top right → <b>Change password</b>.</li>
        </ol>
      </div>
      <p class="sub" style="margin-top:6px">Signing in with a GitHub key instead? Passwords and keys are managed on GitHub:</p>`
      : '<p class="sub">The Studio uses your GitHub account, so passwords and keys are managed on GitHub.</p>'}
      <div class="help">
        <p><b>Forgot your GitHub password?</b></p>
        <ol>
          <li>Open <a href="https://github.com/password_reset" target="_blank" rel="noopener">GitHub password reset</a> and enter your email.</li>
          <li>Follow the link in the email to choose a new password.</li>
        </ol>
        <p><b>Lost or expired access key?</b></p>
        <ol>
          <li>Sign in to GitHub, then open <a href="${NEW_KEY_URL}" target="_blank" rel="noopener">New access key</a>.</li>
          <li>Press <b>Generate token</b>, copy the key and sign in again here.</li>
          <li>Old keys can be removed under <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">GitHub → Settings → Tokens</a>.</li>
        </ol>
        <p>No access to <b>${esc(REPO.owner)}/${esc(REPO.repo)}</b>? Ask a Studio admin to invite you.</p>
      </div>
      <a class="btn" href="#/login">Back to sign in</a>
    </div>`;
}
