# Website editing demo: sample photos

The "Try the editing tools" section of `site/index.html` (code in `site/assets/demo.js` and `demo.css`) loads its
sample photos from one list: [`photos.json`](photos.json). To change the photos, edit only that file.

It is a demo of the tools, not Kestrel's RAW engine. The page says so, and it must keep saying so.

## The list

Up to **5** entries are used, in order. Each entry:

| Field | Required | What it is |
| --- | --- | --- |
| `id` | yes | Short unique name, e.g. `heron-river`. |
| `title` | yes | Shown under the thumbnail, e.g. "Heron at the river". |
| `alt` | yes | A plain description of the unedited photo, for screen readers. |
| `src` | yes | The photo to edit (see sizes below). |
| `denoised` | no | The same photo, same size and framing, with noise reduced. The Denoise slider blends towards it. Without it, Denoise falls back to a simple blur and the page says it is a blur. |
| `mask` | no | Subject mask: white subject on black, same framing (any size, e.g. half resolution). Without it, "Select subject" is turned off for that photo. |
| `thumb` | no | Small picker image (about 240 × 160). Without it, `src` is used. |
| `subject` | no | Words for the subject, shown as "Subject selected: …". |
| `credit`, `licence` | yes | Who made it and on what terms. Shown nowhere yet, but must be filled in. |

Paths can be relative to `photos.json` (`photos/heron.webp`) or full `https://` URLs (for example a Cloud Storage
bucket). A bucket on another domain must allow the site's origin in its CORS settings (`GET`, origin
`https://kestrel-hosting-kestrel.web.app`), because WebGL cannot read images that do not allow it.

## What the owner needs to provide per photo

1. **The photo** (`src`): JPEG or WebP, 3:2 or similar, **1200–1600 px on the long edge**, under about 500 KB. Choose a
   straight-from-camera rendering that has room to improve (a little dark, flat or noisy), not the finished edit.
2. **Denoised version** (`denoised`, optional but recommended for a noisy photo): the same export after noise reduction,
   with identical size, crop and tone, so only the noise changes when the slider moves.
3. **Subject mask** (`mask`, optional): PNG, white where the subject is and black elsewhere, same framing. Soft edges
   are fine. It can come from Kestrel's own subject mask or be painted by hand; label stays "pre-made mask".
4. **Thumbnail** (`thumb`, optional): about 240 × 160 WebP or JPEG.
5. **Alt text, title, subject words, and credit/licence.** Only the owner's own photos or photos they hold a licence
   for. Never other people's photos without permission.

## Current samples

The five samples in `photos/` are **synthetic**: drawn from code by
[`scripts/site/generate-demo-photos.mjs`](../../scripts/site/generate-demo-photos.mjs) (run `node
scripts/site/generate-demo-photos.mjs` after `npm ci`). They are not photographs of anything, so there is no
third-party licence. Their "denoised" files are the same drawing without the added noise, and their masks are the
drawn subject shapes. They stand in for the owner's photos until those are uploaded.

## Checks

`npx playwright test tests/site-demo.spec.ts` serves `site/` and checks that the demo loads all photos, that a slider
changes the image, that the guided tour closes with Escape, and that it fits a 375 px phone screen.
