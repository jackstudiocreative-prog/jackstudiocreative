// My account — who is signed in, and changing your own password (Studio accounts)
import { signedInWith, changePassword } from '../github.js';
import { esc, toast, busy } from '../ui.js';

export async function render(el, { user }) {
  const account = signedInWith() === 'account';
  el.innerHTML = `
    <div class="page-head"><h1>My account</h1></div>
    <section class="panel narrow">
      <h2>${esc(user.name)}</h2>
      <p class="sub">${account ? `Username <b>${esc(user.login)}</b>` : `GitHub account <b>${esc(user.login)}</b>`} · ${user.role === 'admin' ? 'Admin' : 'Staff'}</p>
      ${account ? `
      <form id="pw" novalidate>
        <div class="field"><label for="current">Current password</label><input class="input" id="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="next">New password</label><input class="input" id="next" type="password" autocomplete="new-password" minlength="8" required>
          <span class="hint">At least 8 characters. Your other devices are signed out.</span></div>
        <div class="field"><label for="again">New password again</label><input class="input" id="again" type="password" autocomplete="new-password" required></div>
        <p class="error" id="pw-error" role="alert"></p>
        <button class="btn" type="submit" id="save">Change password</button>
      </form>`
      : '<p class="sub">You are signed in with your own GitHub key, so your password and key are managed on <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">GitHub</a>.</p>'}
    </section>`;

  const $ = (s) => el.querySelector(s);
  $('#pw')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const current = $('#current').value, next = $('#next').value;
    const fail = (t) => { $('#pw-error').textContent = t; };
    fail('');
    if (!current || !next) return fail('Fill in your current and your new password.');
    if (next.length < 8) return fail('The new password needs at least 8 characters.');
    if (next !== $('#again').value) return fail('The two new passwords are not the same.');
    busy($('#save'), 'Saving…', async () => {
      try { await changePassword(current, next); e.target.reset(); toast('Password changed'); }
      catch (err) { fail(err.message); }
    });
  });
  return {};
}
