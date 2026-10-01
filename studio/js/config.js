// Which GitHub repository the Studio reads and writes.
// The public site is served by GitHub Pages from this same repository.
export const REPO = {
  owner: 'jackstudiocreative-prog',
  repo: 'jackstudiocreative',
  branch: 'main',
};

// Private repository for the product photo library (originals). Only team members can see it.
export const PHOTOS_REPO = 'jackstudio-photos';

// Base URL of the public site, worked out from where the Studio is opened
// (…/studio/ → …/). Works on github.io and on a custom domain alike.
export const SITE_BASE = new URL('../', new URL('.', location.href)).href.replace(/\/$/, '');

export const SERIES = ['Urban Carry', 'Craft Heritage', 'Travel Movement', 'Professional', 'Essential', 'Make It Personal', 'Craft Innovation'];
