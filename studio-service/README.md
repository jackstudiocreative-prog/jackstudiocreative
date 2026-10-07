# Jack Studio 360° sign-in service

Lets an admin create Studio accounts (username + password) in **Studio → Team**, so staff don't need a GitHub account.

The Studio itself stays on GitHub Pages. This folder is the only part that runs somewhere else: a few small functions on Vercel.

## How it works

1. A person signs in with a username and password. The service checks the password.
2. The service gives the Studio a GitHub key that works for **one hour**, for the Studio's repositories only. The Studio fetches a new one when it runs out.
3. Switching an account off, or changing its password, ends its sessions: within the hour it can no longer save anything.

The long-lived secret (a GitHub App's private key) only exists on Vercel, as the environment variable `STUDIO_KEY`. There is no database: the account list is stored encrypted in this repository, on the branch `studio-accounts`. Passwords are stored as salted scrypt hashes inside that encrypted file.

## Setting up

Follow the four steps in **Studio → Team** (signed in with the owner's GitHub key). In short:

1. Create the GitHub App (one button).
2. Install it on `jackstudiocreative` (and `jackstudio-photos`, if the photo library is used).
3. Import this repository on Vercel with **Root Directory** `studio-service` and the environment variable `STUDIO_KEY`.
4. Paste the Vercel address in the Studio and save.

## Good to know

- **The owner keeps signing in with a GitHub key.** That is the way back in if this service is ever down, and the only way to set it up.
- **Changing `STUDIO_KEY`** (for example after creating a new GitHub App) signs everyone out and makes the saved accounts unreadable; the Team page then offers to start again with no accounts.
- **Every save in the Studio is a commit, and Vercel redeploys on every commit.** That is harmless. To stop it, set *Project Settings → Git → Ignored Build Step* to "Only build if there are changes in a folder".
- **Wrong passwords:** after 8 in a row for one username from one address, sign-in for it pauses for 15 minutes.
- **Vercel's free plan ("Hobby") is meant for personal, non-commercial use.** For a business, Vercel expects the Pro plan. The functions here are plain Node.js and can be moved to another host.

## Files

| File | What it does |
|---|---|
| `api/login.js` | Username + password → session |
| `api/me.js` | Who is signed in; is the account still on |
| `api/token.js` | Session → one-hour GitHub key |
| `api/password.js` | Change your own password |
| `api/accounts.js` | Admins: list, add, change, switch off, delete accounts |
| `api/status.js` | Is the service set up? (no secrets) |
| `api/_lib/core.js` | Shared code: GitHub App, encryption, sessions |
