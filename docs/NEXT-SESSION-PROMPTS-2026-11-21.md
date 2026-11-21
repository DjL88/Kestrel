# Prompts for the next sessions — 21 November 2026

Four self-contained prompts. Paste one into a fresh Claude session. Each assumes the session reads `CLAUDE.md` first and works from the latest `main`. They record what was learned on 21 Nov so nobody repeats it.

**Facts every session should know**
- `main` after #676 and #680: lint PASS, `npm test` 1540 pass / 0 fail / 1 skipped.
- Full desktop Playwright, measured: **112 passed / 111 failed / 9 skipped**. Phone project never run. Failures are mostly stale selectors, duplicated controls and timeouts.
- In the Claude cloud container: run Playwright with `KESTREL_CHROME_PATH=/opt/pw-browsers/chromium`, at most 4 workers, and do **not** run builds or other heavy jobs at the same time (contention causes false timeouts). A full desktop run takes about 35 minutes.
- Model hosts (`huggingface.co`, GitHub release assets, `storage.googleapis.com` objects) are **blocked** in the default cloud network policy; PyPI and npm are open. The owner must add hosts under the environment's Network access (Allowed domains, "Allow package managers" ticked).
- `gcloud` in that container has an invalid `CLOUDSDK_AUTH_ACCESS_TOKEN` that overrides logins: `unset CLOUDSDK_AUTH_ACCESS_TOKEN` per command. Sign in with `gcloud auth login --no-launch-browser`. Never read secret values; never apply Terraform or deploy without owner approval.
- Never write "should pass". Report each check as PASS / FAIL / NOT RUN.

---

## Prompt 1 — Make the browser suite a real safety net (and remove duplicate controls)

> Repository `DjL88/Kestrel`. Read `CLAUDE.md`, `docs/ROADMAP.md` (P0.0 "one green test baseline"), `docs/accessibility.md`, and issue #418.
>
> **Goal:** turn the 111 failing desktop Playwright tests into a trustworthy suite, and remove the duplicated controls they reveal. Quality over quantity: no skipping, deleting or loosening a test to get green.
>
> 1. Reproduce: build with the env in `playwright.config.ts`, serve with `vite preview`, run `npx playwright test --project=desktop --trace off --workers=4` with `KESTREL_CHROME_PATH=/opt/pw-browsers/chromium`. Save the failure list.
> 2. Classify **every** failure as (a) app bug, (b) duplicated or moved control, (c) stale test, (d) environment/load. Write the table in `docs/ROADMAP.md` or the PR, not a new file.
> 3. Fix the app bugs first. Known duplicates that break the "no duplicate UI" rule: two "Full screen" buttons, two "Edit selected" buttons, two "Photo info" checkboxes (View menu plus "Fold tools and photo info"). Keep one control each; keep it translated in all full locales.
> 4. Known stale areas: per-tile `Keep <file>` buttons no longer exist in the grid (decisions are in the selection bar and Photo info); backup default is now "Automatic: device and photo source" (tests expect "Not set up"); `workspace-window-layout` "View menu can independently hide, show, undock and dock" times out after re-opening the View menu — find out whether the menu really stays open. Add one shared helper in `tests/helpers.ts` for "keep this photo" instead of repeating selectors.
> 5. Run the **phone** project too (`--project=phone`) and report it.
> 6. Small PRs, one theme each. Each PR states PASS / FAIL / NOT RUN for `npm run lint`, `npm test`, `npm run build`, and the specs it touched.
>
> **Done when:** the desktop project is green or every remaining failure is a documented, owner-visible bug with a reproducer; the phone project has been run and its result recorded; no duplicate control remains. Update the ROADMAP integration log.

---

## Prompt 2 — Payments, sign-in, deploy and release

> Repository `DjL88/Kestrel`. Read `CLAUDE.md`, `docs/BACKEND-HANDOVER.md` (especially "People sign-in and entitlements"), `services/control-plane/README.md`, `infra/gcp/README.md`, `docs/COMMERCIAL-RELEASE.md`.
>
> **Already built (PR #680):** entitlements keyed to the person (`majorVersion`, `paid`, `source`, hashed email), `POST /v1/admin/licences/grant`, `POST /v1/auth/apple` and `/v1/auth/google`, Terraform variables `apple_client_ids` and `user_google_client_ids` (not applied). `purchaseEntitlement` in `services/control-plane/src/entitlement.ts` is tested but **no route calls it**.
>
> **Do, in this order, stopping where the owner must act:**
> 1. **Checkout route.** Start a SumUp hosted checkout from the tax-quoted price (`src/commerce/tax.ts`, `sumup.ts`), store the order, and on return **retrieve and match the payment from SumUp** (`sumupCheckouts().verify`), then `CommerceLedger.recordPaid`, then `store.grantLicence(purchaseEntitlement(...))`. Idempotent on the checkout reference. Never grant on an unverified callback. Tests on SQLite and the Firestore fake.
> 2. **App side.** Settings → Licence: sign in with Apple/Google, show plan, version, paid or gift, AI allowance; fetch the signed offline grant via `/v1/me/entitlements`; Free works fully offline and unchanged. British English, all full locales, keyboard accessible, no dark patterns. Handle Apple "Hide my email" (`privateRelay: true`) with a clear explanation and a way to link the purchase email.
> 3. **Owner gates (ask, don't guess):** Apple Services ID and bundle id; Google OAuth client ids; SumUp API key in secret `kestrel-sumup-api-key`; approval to build an image and show a `terraform plan`. Apply nothing without approval. Terraform is not installed in the cloud container: ask before installing, or hand the owner the exact commands.
> 4. **Website.** View `kestrel-hosting-kestrel.web.app` from a machine that can reach it; check prices, currency picker, translations, contact form, downloads, no GitHub/beta links.
> 5. **Releases.** Signed Windows installers and notarised macOS builds. The owner has an Apple Developer account; Developer ID / distribution certificates and notarisation credentials are needed (the uploaded development `.cer` only signs development builds).
> 6. **Legal.** Terms, privacy text, VAT settings, refund text. Draft only; the owner confirms.
>
> **Done when:** a test payment in SumUp sandbox creates exactly one entitlement, a replay creates none, and an app signed in on a second device sees the plan. Record exact SHA and PASS / FAIL / NOT RUN.

---

## Prompt 3 — Real-photo evidence (needs the owner's files)

> Repository `DjL88/Kestrel`. Read `CLAUDE.md`, `docs/PRODUCT-SPEC.md` §7, `docs/CULL-BENCHMARK.md`, `docs/CULL-RELEASE-GATE.md`, `docs/NIKON-RAW-EVIDENCE-GATES.md`, `docs/nikon-raw-validation.md`, issue #418 items Q-01 to Q-07.
>
> **Rule:** the owner's photos, catalogues and results are never committed or uploaded. Run on the owner's machine (or a session with the folder attached) and commit only aggregate numbers.
>
> Produce, on one exact build SHA, with PASS / FAIL / NOT RUN and sample counts:
> 1. **Import and relink:** 191, then 500, then 2,000 real NEF/JPEG: first usable image time, p50/p95, peak RAM, kill and reopen, missing drive, relink, no wrong-file match.
> 2. **Culling:** keeper recall, false rejects, and burst variety against the owner's Lightroom ratings (`tools/lightroom/read_lrcat.py`). Unknown stays unknown; no uncertain photo auto-rejected. Include difficult negatives (helicopter, aircraft, dippers, tiny birds).
> 3. **RAW provenance:** which decoder produced each image; HE/HE* behaviour stated plainly; the 16-bit export compared with the editor preview (ICC, size, crop, mask parity, source SHA unchanged).
> 4. **Species:** White-throated dipper added; owner's dippers get a dipper suggestion or "unknown", never a confident wrong bird.
> 5. **Speed and memory** on 8, 16 and 32 GB machines and a phone.
>
> **Done when:** `docs/ROADMAP.md` has a results table with numbers, the failing items are filed as owner-visible bugs with reproducers, and nothing claims parity with another editor without matched evidence.

---

## Prompt 4 — Offline photographic intelligence (local vision models)

> Repository `DjL88/Kestrel`. Read `CLAUDE.md`, the latest `main`, `docs/OUTSTANDING-PROGRAMME-2026-11-21.md` §4A–4C, `docs/CLAUDE-RESUME-2026-11-21.md`, `docs/ROADMAP.md`, `docs/models.md`, `docs/EQUIPMENT-UPDATES.md`, issue #418, and the PRs #677 (verified asset activation), #670/#675 (Soar/Glide/Fly Solo), #679 (Colour Confidence), #655 (signed manifests).
>
> **Goal:** working offline vision models in Kestrel, on desktop, web and (later) mobile, that (1) validate the subject and scene alongside subject detection, (2) validate and generate edit suggestions, (3) help automate an image, and (4) help with colour grading and whether the subject's colour is plausible. Real inference, not interfaces or mocks.
>
> **Hard facts learned first**
> - The cloud container blocks model hosts. **Before anything else, ask the owner to allow** `huggingface.co`, `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.hf.co`, `github.com` and `objects.githubusercontent.com` under Network access. Without that you cannot download, hash or license-check weights, and you must not substitute mocks.
> - Already in Kestrel (reuse, don't replace): YOLOX-tiny (detection), U²-Net-P (subject mask), CLIP ViT-B/32 (category gate), BioCLIP int8 (species, v1). See `docs/models.md` and `src/providers/{subjectDetector,categoryGate,speciesModel,modelStore,bundledModelAssets}.ts`.
> - Signed manifest and the `kestrel-hosting-kestrel-models` bucket already exist; PR #677 has the verified-activation design. Reconcile with #655 and #677, do not build a third updater.
>
> **Candidates (verify each exact checkpoint; none is mandatory):** Qwen3-VL-4B-Instruct (quantised), SmolVLM2 (a small size), Florence-2 (base), BioCLIP 2. For each record: exact repo and revision, **licence of the weights and of the conversion** (read the model card at that revision; do not rely on memory), file sizes, SHA-256, supported runtime, measured RAM, latency and tokens/s on this CPU container, and whether it runs in onnxruntime-web (WebGPU/WASM), native ONNX Runtime, or llama.cpp via the Tauri shell. Choose a **small core set**. Document rejected candidates and why.
>
> **Architecture rules**
> - Models **corroborate, challenge or abstain**. Never average confidence percentages. Do not treat agreeing models as independent proof when their errors are correlated (CLIP, BioCLIP and a VLM share training data biases); say which signals are independent (detector box, mask geometry, measured pixels) and which are not.
> - Pixel truth stays deterministic: colour, clipping, highlight and shadow measurements come from Kestrel's own analysis (`src/core/colourCheck.ts`, `aiReview.ts`). A VLM may explain or flag, never assert an exact colour from species alone, never alter pixels, and its edit proposals are bounded standard sliders and masks only, validated like `recipeProposal.ts`.
> - No new AI tab, no wand or sparkle UI, no chat-first flow. Surface through the existing editor and Soar / Glide / Fly Solo semantics (Glide default; Fly Solo only on request).
> - Optional, transparent downloads (show size, source, licence); resumable; never silent; previous working model kept for rollback; nothing leaves the device; no photo uploads.
> - Hardware, memory and battery aware model selection with a measured fallback to "no model, deterministic only".
>
> **Deliver**
> 1. `scripts/models/` acquisition scripts: pinned revisions, trusted sources, SHA-256, licence and attribution records (`docs/notices/`), verifying before install. No weights in git.
> 2. Install through the existing store with verified activation and rollback.
> 3. A single inference interface consumed by the editor for the four jobs above, with tests that run the **real** model on synthetic and lawfully licensed fixtures.
> 4. An evaluation set including hard negatives (helicopter vs bird, aircraft, decoys, low-key scenes, orange robin breast, green foliage, blue sky) and measured abstention and error rates, reported honestly with sample counts.
> 5. Measured numbers per platform: load time, first-token or first-result latency, peak RAM, battery or CPU load where measurable.
>
> **Done when:** a real model installs from a pinned, hash-checked source, runs offline, and the editor shows a validated subject/scene check and a bounded, reversible suggestion; failures abstain; PASS / FAIL / NOT RUN is recorded for lint, tests, build and the relevant Playwright specs. Anything not measured is labelled NOT RUN, not estimated.
