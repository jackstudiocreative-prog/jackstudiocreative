// Team — account management (admins only)
import { listTeam, inviteMember, removeMember, cancelInvite, syncPhotoAccess } from '../github.js';
import { REPO, PHOTOS_REPO } from '../config.js';
import { esc, toast, busy, timeAgo } from '../ui.js';

const ROLE = { admin: 'Admin', staff: 'Staff', viewer: 'View only' };

export async function render(el, { user }) {
  const team = await listTeam();
  el.innerHTML = `
    <div class="page-head"><h1>Team</h1></div>
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

      <section class="panel">
        <h2>Invite a team member</h2>
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
        <p class="sub">If someone can't open <b>Product Library → Photos</b>, this re-sends their photo library invitation with the same role they have here.</p>
        <button class="btn btn--ghost btn--sm" type="button" id="sync">Give everyone photo access</button>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const reload = () => render(el, { user });

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

  el.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => {
    try { await inviteMember(s.dataset.role, s.value); toast(`${s.dataset.role} is now ${ROLE[s.value]}`); }
    catch (err) { toast(err.message, true); reload(); }
  }));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(`Remove ${b.dataset.remove}? They lose access to the Studio immediately.`)) return;
    busy(b, 'Removing…', async () => {
      try { await removeMember(b.dataset.remove); toast('Removed'); reload(); } catch (err) { toast(err.message, true); }
    });
  }));
  el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => busy(b, 'Cancelling…', async () => {
    try { await cancelInvite(b.dataset.cancel); toast('Invitation cancelled'); reload(); } catch (err) { toast(err.message, true); }
  })));
  return {};
}
