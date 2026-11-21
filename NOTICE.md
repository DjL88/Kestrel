# Third-party notices

Kite44's own code is proprietary (see LICENSE). It bundles the open-source
components below, each under its own license. This list was compiled by hand
from `package.json` and `src-tauri/Cargo.toml` on 2026-11-17 — it is a starting
point, **not a verified, complete, transitive dependency audit**. Before any
public or paid release, run an automated scan (for example `npx license-checker
--summary` for npm packages and `cargo install cargo-license && cargo license`
for Rust crates) against the actual lockfiles, and reconcile the result with
this file. Treat any mismatch as the lockfile being right and this file needing
an update.

## Needs a legal decision before release: `rawler` (Rust, native RAW decoding)

`src-tauri/src/raw.rs` links the `rawler` crate, licensed **LGPL-2.1**. Rust has
no stable dynamic-linking ABI, so Kite44's desktop binary statically links it,
and LGPL-2.1 compliance for a statically-linked proprietary binary is a genuinely
unsettled area (the usual remedies — dynamic linking, or shipping relinkable
object files — don't map cleanly onto Rust's toolchain). `rawler`'s own source
is public and its exact pinned version is recorded in `src-tauri/Cargo.lock`,
which is the usual practical answer, but **get this specifically reviewed by a
lawyer before shipping a signed, paid build** — don't treat this notice as that
review.

## Nikon HE/HE* decoding: `ticoraw` (owner decision recorded 19 Nov 2026)

`crates/kestrel-raw/src/nikon_he.rs` (shared by the desktop app and the web build) links the `ticoraw` crate (0.2.0, pinned) to decode
Nikon High Efficiency (HE/HE*) NEFs from their sensor data. Its **copyright**
licence is MIT OR Apache-2.0, which is compatible with a proprietary app. But the
TicoRAW / JPEG XS codec it implements is **covered by patents** (intoPIX), and the
crate author states the copyright licence is not a patent licence. Writing our own
decoder would not avoid the patents.

**Owner decision (19 Nov 2026):** Kite44 ships its own HE/HE* decoder in every
build (desktop, web and mobile), as one decoder for all platforms. The operating
system's decoder is used only where Kite44's cannot read a file. The patent
exposure is accepted by the owner; this note records it and is not legal advice.
The code stays behind the `nikon-he` Cargo feature (on by default), so a build
without it is one flag away (`--no-default-features`, or
`npm run raw:wasm -- --without-nikon-he`) if that decision changes.

## The web app's RAW decoder (`src/assets/wasm/kestrel_raw.wasm`)

The web app ships Kite44's RAW pipeline (`crates/kestrel-raw`, via `crates/kestrel-raw-wasm`) compiled to
WebAssembly. Serving the web app distributes that binary, so the `rawler` LGPL-2.1 question above applies to it too.
The source of every part is in this repository and the binary is rebuilt with `npm run raw:wasm`. It includes the
`nikon-he` codec (`ticoraw`), per the owner decision above, so the web app and the mobile shells decode HE/HE* with the
same code as the desktop app.

## HEIF/HEIC decoding: `libheif-js` 1.23.5 (LGPL-3.0) — needs a legal decision before release

Opt-in experimental builds (`VITE_EXPERIMENTAL_HEIF_WASM=true`) can decode HEIF photos with
**libheif** and its HEVC decoder **libde265**, compiled to WebAssembly and
published on npm as `libheif-js` (pinned to exactly **1.23.5**, published
4 Oct 2026; source: https://github.com/catdad-experiments/libheif-js, which
builds https://github.com/strukturag/libheif and
https://github.com/strukturag/libde265). The package, libheif and libde265 are
all **LGPL-3.0**. The full licence text ships inside the package
(`node_modules/libheif-js/LICENSE`) and must ship with Kite44 too.

**This is not a "clean" permissive licence.** LGPL-3.0 allows use in a
proprietary app, but on conditions: say that the library is used and under which
licence (this notice), provide the LGPL and GPL texts, make the library's source
(for the exact version shipped) available, and let the user replace the library
with a modified version. How the decoder is kept separate:

- It lives only behind Kite44's HEIF adapter (`src/providers/heifDecode.ts`,
  `heifWasmWorker.ts`, `heifWasmCore.ts`). Nothing else in the app imports it.
- Vite emits it as its own file (a worker chunk, `heifWasmWorker-*.js`, with the
  WebAssembly inlined), built only when the experimental flag is enabled and used only if native decoding fails. Replacing that
  one file replaces the decoder; Kite44's own code is not compiled into it.
- A native decoder (Windows WIC/HEIF extension, macOS ImageIO) could take its
  place in the adapter without touching the rest of the app, if that is the
  decision.

Separately, **HEVC (H.265) is covered by patent pools** (Access Advance, Via LA
and others). The LGPL is a copyright licence, not a patent licence; shipping an
HEVC decoder in a paid product may need a patent licence in some countries.
Operating-system decoders avoid that only on systems that already carry one
(Windows charges for its HEVC extension). **Owner/lawyer decision needed before a
paid release**; this note records the question and is not legal advice.

## Rust crates (desktop shell, `src-tauri/Cargo.toml`)

| Crate | License | Role |
| --- | --- | --- |
| `rawler` | LGPL-2.1 | Native RAW decoding — see above |
| `ticoraw` | MIT OR Apache-2.0 (codec patented; see above) | Nikon HE/HE* sensor decoding, feature `nikon-he` |
| `image` | MIT OR Apache-2.0 | JPEG/PNG encode/decode for developed RAW output |
| `tauri`, `tauri-plugin-*` | MIT OR Apache-2.0 | Desktop shell, filesystem, dialog, updater, HTTP, process plugins |
| `serde`, `serde_json` | MIT OR Apache-2.0 | Data (de)serialisation |

## JavaScript/TypeScript packages (`package.json`)

| Package | License | Role |
| --- | --- | --- |
| `react`, `react-dom` | MIT | UI framework |
| `vite`, `@vitejs/plugin-react` | MIT | Build tooling |
| `@tauri-apps/api`, `@tauri-apps/plugin-*` | MIT OR Apache-2.0 | Desktop bridge (JS side) |
| `exifr` | MIT | EXIF/metadata parsing |
| `fflate` | MIT | ZIP export |
| `libheif-js` (libheif + libde265, WebAssembly) | LGPL-3.0 (HEVC patents; see above) | HEIC/HEIF/HIF decoding, behind `src/providers/heifDecode.ts` |
| `lucide-react` | ISC | Icons |
| `onnxruntime-web` | MIT | Runs the local, offline ML models (subject/species detection) in the browser/webview — no data leaves the device for this |
| `@fontsource/inter`, `@fontsource/plus-jakarta-sans`, `@fontsource/atkinson-hyperlegible` | SIL OFL-1.1 | Bundled fonts. Atkinson Hyperlegible is designed by the Braille Institute for readability — keep its attribution if it's ever promoted in marketing as an accessibility feature. |
| `@tailwindcss/vite`, `tailwindcss`, `autoprefixer` | MIT | Styling (build-time) |

Dev-only tooling (not shipped in the app: `typescript`, `tsx`, `@playwright/test`,
`zod`, `@modelcontextprotocol/sdk`, `@tauri-apps/cli`) is omitted here since it
isn't distributed to users, but include it in a full scan if you ever publish
build tooling or a plugin SDK separately.

## Machine-learning models

- **Category gate (CLIP ViT-B/32 image encoder, MIT)**: `public/models/clip-vit-b32-vision-uint8.onnx`,
  shipped in desktop installers. Notice text in `docs/notices/clip.txt`; ship it alongside.
- **Species suggestions (BioCLIP, MIT)** — already documented in full, including
  the required reproduced license text, in `docs/notices/bioclip.txt`. Keep that
  file alongside any build that bundles the species model.
- **Subject/eye detection models** (`src/assets/models/u2netp.onnx`,
  `yolox_tiny.onnx`) — confirm and document their license and training-data
  provenance the same way before they ship in a paid build; `docs/
  SPECIES-TAGGING-SPIKE.md` and `docs/models.md` have the research trail for
  BioCLIP but these two don't yet have an equivalent notice file. Add one.

## What to do next

1. Run the automated scans above and diff them against this file.
2. Get the `rawler` LGPL-2.1 static-linking question and the `libheif-js`
   LGPL-3.0 / HEVC patent question answered by a lawyer. (The
   TicoRAW patent question for `ticoraw` is an owner-accepted risk; see above.)
3. Write the missing per-model notice for `u2netp.onnx` / `yolox_tiny.onnx`.
4. Ship this file (or its generated successor) alongside every installer, the
   way `docs/notices/bioclip.txt` already is — not just in the git repo.
