# Jack Studio 360°

360° product views and virtual showroom tours for Jack Studio, built and published by the team without any paid service.

- **Public site:** https://jackstudiocreative-prog.github.io/jackstudiocreative/
- **Studio (team workspace):** https://jackstudiocreative-prog.github.io/jackstudiocreative/studio/
- **Phone 360° capture:** https://jackstudiocreative-prog.github.io/jackstudiocreative/capture/

## How it works

The site runs on GitHub Pages. The Studio uses this GitHub repository as its backend: every save is a commit, and GitHub Pages republishes the site about a minute later. Nothing else needs to be hosted or paid for.

```
Login ─┬─ failed → back to the home page
       ├─ forgot password → reset (GitHub password / new access key)
       └─ success → Workspace
              ├─ Projects
              ├─ New Project → Product 360° (photos / video / 3D)  ┐
              │              → Showroom (panoramas + hotspots)     ┴→ Preview → Publish → Share link · QR code · Shopify embed
              ├─ Product Library (Products · Photos)
              ├─ Assets
              ├─ Preview & Publish
              └─ Team (admins) / My Workspace (staff)
```

## Team access

1. Every team member needs a free GitHub account.
2. An admin invites them in **Studio → Team** (role **Staff** or **Admin**). GitHub emails the invitation.
3. After accepting, they create an access key at
   https://github.com/settings/tokens/new?scopes=repo&description=Jack%20Studio%20360%20Studio
   (classic token, **repo** scope) and sign in to the Studio with it.

| Role | Can do |
|---|---|
| Staff | Create, edit, preview and publish projects; product library; assets |
| Admin | Everything, plus team management and deleting any project |

## Creating 360° content

- **Product 360°:** upload 24–72 turntable photos, or a video of one full turn (frames are extracted automatically). Optional 3D model: Blender → glTF Binary (.glb), plus .usdz for iPhone AR.
- **Showroom:** upload 2:1 panoramas from a 360° camera, or capture one with a normal phone at `/capture/` (it stitches on the phone and can save straight to the Asset Library). Then click on the panorama to place hotspots: links to other scenes, products, or info.
- **Preview** shows the saved draft; **Publish** makes it public. Share via link, QR code, or the Shopify embed code (paste into a *Custom liquid* section).

## Photo library (private)

**Product Library → Photos** stores original product photos in a separate **private** repository, `jackstudio-photos`, so only the team can see them and they don't count towards the website's 1 GB.

- **First time:** the account owner opens Product Library → Photos and presses **Set up photo library**. This creates the private repository and invites the current team.
- **Upload:** choose photos and give each one its SKU. **Use SKU from file names** reads names like `JS1023-BRN_front.jpg` → `JS1023-BRN`. Originals are stored unchanged (up to 50 MB each).
- **Find:** search by SKU, product name (if the product in the library has that SKU), file name or tag.
- **Download:** open a photo for the original, or tick several (or **Download all** for a SKU) to get a zip.
- **Access:** members get a second GitHub invitation for the photo library and must accept it. If someone can't see photos, an admin presses **Give everyone photo access** in Team.
- **Size:** GitHub recommends keeping a repository under about 5 GB; the Photos page shows current usage.

## Files

```
index.html · showroom.html · product.html   public pages
studio/                                      the Studio (team workspace)
capture/                                     phone 360° capture + stitching
data/index.json                              project list (rebuilt on every save)
data/projects/<id>.json                      each project: draft + published version
data/library.json                            product library
media/                                       photos, panoramas, 3D models
assets/                                      styles, scripts, fonts, open-source libraries
```

GitHub Pages sites are limited to 1 GB; the Asset Library shows current usage and lets you delete unused files.

Open-source libraries included: Photo Sphere Viewer (MIT), three.js (MIT), model-viewer (Apache 2.0), qrcode-generator (MIT), Bebas Neue and Inter fonts (SIL OFL).
