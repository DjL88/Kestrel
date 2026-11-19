# Kestrel: working rules for every contributor and agent

Kestrel is an offline-first, nondestructive photo workflow: import, cull, develop, export, reopen. It runs on Windows, macOS, web, and later iOS and Android, from one codebase. Several Claude sessions (on the Mac, on the Windows laptop, and scheduled workers) change this repository in parallel. These rules keep them building **one** product.

**Shared cross-agent coordination:** [GitHub issue #418 — Kestrel build board](https://github.com/DjL88/Kestrel/issues/418) is the live 10-track claim, status and handover board. All tools (including Claude and Codex) must check its newest comments and existing file claims before beginning. Only the coordinator updates the shared checklist; individual agents leave evidence-bearing comments. [AGENTS.md](AGENTS.md) provides a tool-neutral entry point. The product contract and roadmap below remain authoritative for intent and verified status.

## Read first, every session
1. [docs/PRODUCT-SPEC.md](docs/PRODUCT-SPEC.md) says what Kestrel must be. Treat it as the contract.
2. [docs/ROADMAP.md](docs/ROADMAP.md) gives verified status and the next P0 item. Pick work from here, not from older docs ([docs/README.md](docs/README.md) lists what's history).
3. Live state, as below. Branches and PRs move hourly, so never trust a remembered state.

```bash
git fetch origin && git log --oneline -15 origin/main
gh pr list --state open
```

## Non-negotiables (details in the spec)
- Originals are never written, moved or replaced. Kestrel stores links, previews and reversible recipes.
- Core use works fully offline. No uploads, telemetry or accounts by default.
- Never overstate anything: RAW decode versus embedded preview, species, eye focus, colour, and parity with other editors. Unknown stays unknown.
- Never silently downsample, attach the wrong file, or discard a decision. Uncertain photos are kept for review, never auto-rejected.
- One behaviour on every platform. Platform differences live only in adapters (`src-tauri/`, `src/providers/`). Shared logic stays in `src/core/` (pure, unit-tested) and `src/components/`.
- Calm and accessible: no colour-only cues, keyboard access, reduced motion, British English.

## How to make a change
- Take **one** bounded item, the first unblocked one in ROADMAP P0 unless the owner asks otherwise. Check the open PRs for overlap before starting. Make it a small PR on its own branch.
- **Repair your own open PRs before opening another.** Don't stack drafts nobody will review.
- New code is wired into the app, or it isn't merged. A prototype nothing calls, or a plan that duplicates ROADMAP.md, goes into ROADMAP.md instead of a new file.
- Update ROADMAP.md in the same PR when an item's status changes.
- Use only synthetic or lawfully licensed fixtures. Never commit or upload the owner's photos, catalogues or results.
- `tools/denoise-training/` belongs to the denoiser track. Coordinate before changing it.
- Keep AI Studio compatibility: `DISABLE_HMR` in `vite.config.ts`, `metadata.json`, port 3000, and the npm script names.

## Checks
Run on a real checkout before asking for a merge, and report each one as **PASS / FAIL / NOT RUN (reason)**. Never write "should pass".

```bash
npm ci
npm run lint                  # TypeScript
npm test                      # unit tests (src/core, src/providers, tools/mcp, services/control-plane)
npm run build
npx playwright test           # browser tests, desktop and phone projects
cd src-tauri && cargo test    # when Rust or src-tauri changed
python -m pytest scripts tools/denoise-training tools/lightroom   # when Python changed
```

## Merging
- Merge when every check relevant to the change has PASSED on a real checkout and the results are written in the PR.
- **While GitHub Actions is billing-blocked (until about 24 Nov 2026), the owner has authorised merging on local results.** Workflow runs that fail with zero steps are INFRASTRUCTURE BLOCKED, not failures. Don't re-run them, and don't pay to get around the block.
- Squash-merge, delete the branch, and add a line to the ROADMAP integration log.
- A change to Rust that couldn't be compiled stays unmerged unless it only touches tests or message text, and the PR says so.

## Builds the owner installs
- Only optimised (`release=true`) builds of `main` go to the owner, built from the same commit for Windows and macOS. Debug and PR builds show a console window, run slowly, and quit when the console closes.
- Before reporting that "Windows and Mac differ", compare **Settings → Build information** (commit and build time) on both machines.
- While cloud builds are blocked, build Windows locally from `main` with `scripts/windows/Build-Kestrel.ps1` (optimised installer, same as `npm run desktop:build` on the Mac).

## Reporting back
End every working session with:
- the branch, commit and PR links;
- what changed;
- the evidence, with check labels;
- what isn't verified;
- the next concrete action.
