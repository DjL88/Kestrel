# Working on Kestrel

Read `docs/ROADMAP.md` before anything else. It is the product contract, the current status (Built / Unverified /
Planned / Open decision) and the priority order. Work on the highest item that is not already covered by an open PR.

- Kestrel is one React/TypeScript app on every platform. Shared behaviour lives in `src/core/`; platform differences
  only in `src/providers/` and `src-tauri/`, and each one must be listed in `docs/ROADMAP.md` section 3.
- Extend the canonical path instead of adding a parallel one: one denoiser pipeline (`tools/denoise-training/README.md`),
  one Lightroom reader (`tools/lightroom/read_lrcat.py`), one offline worker (`offline-build.ts`).
- Never: upload user photos, provision cloud resources, accept SDK licences, spend money, overwrite originals, or claim
  a capability that has not been observed. Report checks as PASS / FAIL / NOT RUN / INFRASTRUCTURE BLOCKED.
- Checks before merging: `npm run lint`, `npm test`, `npm run build`, `cargo test --release` (in `src-tauri`), and
  `python -m unittest discover -s <dir> -p "test_*.py"` for `scripts`, `tools/denoise-training` and `tools/lightroom`.
  While GitHub Actions is paused for billing, the owner has authorised merging once these pass locally.
- When something changes state, update `docs/ROADMAP.md`. Do not start new plan or handover documents.
- British English, plain words, no jargon in the interface.
