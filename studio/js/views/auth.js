// Login & reset password (diagram: Login → Failed → Home page / Forgot password → Reset → Login)
import { setToken, whoAmI } from '../github.js';
import { REPO } from '../config.js';
import { esc } from '../ui.js';

const NEW_KEY_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Jack%20Studio%20360%20Studio';

export function render(el, { mode = 'login', message = '', onSignedIn }) {
  if (mode === 'forgot') return renderForgot(el);

  el.innerHTML = `
    <form class="auth-card" id="login-form" novalidate>
      <a class="brand" href="../">JACK STUDIO <span>360°</span></a>
      <h1>Sign in</h1>
      <p class="sub">The internal workspace for creating 360° products and showrooms.</p>

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

      <label class="check"><input type="checkbox" id="remember" checked> Keep me signed in on this device</label>
      <p class="error" id="login-error" role="alert">${esc(message)}</p>
      <div class="auth-failed" id="failed" ${message ? '' : 'hidden'}>
        <a href="../">← Back to home page</a>
      </div>
      <button class="btn" type="submit" id="submit">Sign in</button>
      <p class="auth-links"><a href="#/forgot">Forgot your password or key?</a></p>
    </form>`;

  const $ = (s) => el.querySelector(s);
  $('#how').addEventListener('click', () => { $('#help').hidden = !$('#help').hidden; });
  $('#key').focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#key').value.trim();
    $('#login-error').textContent = '';
    if (!key) { $('#login-error').textContent = 'Paste your GitHub access key.'; return; }
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

function renderForgot(el) {
  el.innerHTML = `
    <div class="auth-card">
      <a class="brand" href="../">JACK STUDIO <span>360°</span></a>
      <h1>Reset access</h1>
      <p class="sub">The Studio uses your GitHub account, so passwords and keys are managed on GitHub.</p>
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
