# Third-party notices

Kestrel's own code is proprietary (see LICENSE). It bundles the open-source
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
no stable dynamic-linking ABI, so Kestrel's desktop binary statically links it,
and LGPL-2.1 compliance for a statically-linked proprietary binary is a genuinely
unsettled area (the usual remedies — dynamic linking, or shipping relinkable
object files — don't map cleanly onto Rust's toolchain). `rawler`'s own source
is public and its exact pinned version is recorded in `src-tauri/Cargo.lock`,
which is the usual practical answer, but **get this specifically reviewed by a
lawyer before shipping a signed, paid build** — don't treat this notice as that
review.

## Rust crates (desktop shell, `src-tauri/Cargo.toml`)

| Crate | License | Role |
| --- | --- | --- |
| `rawler` | LGPL-2.1 | Native RAW decoding — see above |
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
| `lucide-react` | ISC | Icons |
| `onnxruntime-web` | MIT | Runs the local, offline ML models (subject/species detection) in the browser/webview — no data leaves the device for this |
| `@fontsource/inter`, `@fontsource/plus-jakarta-sans`, `@fontsource/atkinson-hyperlegible` | SIL OFL-1.1 | Bundled fonts. Atkinson Hyperlegible is designed by the Braille Institute for readability — keep its attribution if it's ever promoted in marketing as an accessibility feature. |
| `@tailwindcss/vite`, `tailwindcss`, `autoprefixer` | MIT | Styling (build-time) |

Dev-only tooling (not shipped in the app: `typescript`, `tsx`, `@playwright/test`,
`zod`, `@modelcontextprotocol/sdk`, `@tauri-apps/cli`) is omitted here since it
isn't distributed to users, but include it in a full scan if you ever publish
build tooling or a plugin SDK separately.

## Machine-learning models

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
2. Get the `rawler` LGPL-2.1 static-linking question answered by a lawyer.
3. Write the missing per-model notice for `u2netp.onnx` / `yolox_tiny.onnx`.
4. Ship this file (or its generated successor) alongside every installer, the
   way `docs/notices/bioclip.txt` already is — not just in the git repo.
