# Kestrel alpha plan (one branch, one build)

Goal: a calm, offline, non-generative editor for people who find sliders overwhelming. Flow: **Project (or Quick edit) → Cull to a target → Review suggested looks → Optional full edit → Export.**

## Working rule
One integration branch (`integration/alpha-*`) carries everything. Small PRs are merged into it, never tested on their own. Each alpha build for testing comes from that branch only.

## Status (17 Nov 2026)
| Piece | State |
| --- | --- |
| Filter/Sort, tab-trap and CI fixes (#325) | In integration branch |
| TrueDetail chroma denoise baseline (#322) | In branch; **not wired into editing**; synthetic tests only |
| Insight subject-aware Suggest a look (#323) | In branch; preview-then-Apply; needs real-photo check |
| Cull epoch-zero safety (#324) | In branch |
| Integration check | lint clean, 694 unit tests pass, build passes. Playwright e2e not yet run on the combined branch |

## Order of work
1. **Trust the alpha** — run e2e on the integration branch; test Suggest a look on real wildlife photos (subject found, fallback when not, Apply/Keep).
2. **Beginner path** — one guided route from import to export with a single next action on screen; no more than three visible controls per step; words with icons, never colour alone.
3. **Photo quality** — 16-bit/scene-linear working image from RAW (currently 8-bit RGB then JPEG q95 in `src-tauri/src/raw.rs`); connect TrueDetail to the editor only after blind comparison against Lightroom Denoise, DxO DeepPRIME and NX Studio.
4. **Large libraries** — real 500/2,000-photo import, cancel, relink and memory measurements.
5. **Release** — signing/notarisation, clean-machine Mac and Windows installs, Free/Pro one-time licence.

## Non-goals
Generative fill, invented detail, cloud-only processing. AI is limited to suggestions (tags, masks, scores, recipes) the person approves.
