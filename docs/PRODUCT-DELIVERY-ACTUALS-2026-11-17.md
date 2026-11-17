# Kestrel product delivery — executable recovery plan (17 November 2026)

**North star:** In the installed Mac/Windows application, import 500 mixed camera photos, narrow to 20 best shots, preview subject-aware edits, adjust naturally, export at the best *proven* resolution/colour quality, close and reopen without losing an original or history step. Free and Pro are one-time licences; no cloud account or network is required for local editing.

**Product rule:** A synthetic test establishes code behaviour, not photo quality. A machine-learning model establishes a prediction, not truth. Never claim DeepPRIME parity, official Nikon colour, supported HE/HE* modes, or 16-bit editing without appropriate real-camera and licensed-SDK evidence.

## Execution board (ordered by delivered user value)

| Stage | Accountable scope | Implementation acceptance | Evidence needed |
| --- | --- | --- | --- |
| A — visible Insight editing | Insight PR #323; avoid overlapping PR #325 crop refactor | Suggest a look shows responsive progress, global + *trusted* subject mask, Before/After, Apply/Keep, undo; fallback on model failure. No original or saved edit changes before Apply | Synthetic planner unit tests; Playwright model-failure/undo flow; screenshots and manual real-photo verification |
| B — dependable desktop Alpha | Claude: native menus, install and 500-photo workflow, with worker coordination | Unsigned and clearly labelled macOS/Windows testers install, import, cull, edit, export and reopen. Menus invoke actual commands; no unresponsive button | Green unit, Playwright desktop/mobile, native CI; downloaded installer smoke tests, interrupted/reconnected folders |
| C — RAW image-quality foundation | RAW worker + isolated TrueDetail engineering | Original hash immutable; camera-aware decoder for every *verified* NEF mode, high-precision scene-linear working pixels, ICC transformations and trustworthy export. 8-bit screen previews are replaceable, not the processing original | Pixel/colour test vectors, source checksum checks, peak RAM and timing; Z8/Z5II HE, HE*, lossless evidence matrix against NX Studio |
| D — usable non-generative TrueDetail | TrueDetail PR #322 research → separate image-pipeline PRs | Edge-aware noise reduction on high-precision tiles; luminance/colour denoise; protect feathers, fur, eyes, skies, natural bokeh; adjustable fallbacks on low-memory hardware. No generated detail | Real ISO series with matching RAW from Z8/Z5II; 100% and full-output blind comparisons with NX Studio, Lightroom and DxO; artefact review |
| E — intelligent art-direction recipes | Insight worker, after stable mask/colour pipeline | Tailored choices for wildlife, portraits, aircraft and landscapes, with subject-aware background and local tools, restraint in shadows/highlights and honest reasons. Never guess eye/subject location if detection fails | Real labelled crops, control/no-op/poor-quality cases, useful/no-useful subjective ratings, before/after and Undo/Redo |
| F — commercial polish | product/design + architecture workers | Calm brand, consistent Lucide iconography, colour-blind/keyboard and touch accessibility, quick edit without a project, signed-off Free and lifetime Pro functionality | WCAG-focused manual review, no overflow at required viewports, release entitlement/security tests |

## What actually exists now vs not

- Existing Tauri/React editor, project/backup, culling, recipes, ONNX offline saliency model and nondestructive masks. Subject segmentation alone is not bird/eye identification.
- PR #323 now proposes local subject masks *from live inference in the editor* but stays draft until CI and real-shoot verification.
- PR #322 is a chroma noise-reduction research baseline on both 8-bit preview pixels and post-demosaic Float32 RGB. Not a production denoise engine and not wired into normal export.
- Main editor development currently still uses 8-bit rendering/JPEG RAW intermediate. Experimental 16-bit TIFF path is a separate export and lacks confirmed colour profiles/HE support.
- No one should mark TrueDetail RAW/AI/Select/Batch released before full integration and testing.

## Immediate QA gate for A

1. Disable auto-edit, open a synthetic dark photo, press **Suggest a look**.
2. Observe Analysing… and explicit result text. If detection is unavailable or times out, the global proposal still works.
3. Compare the proposed recipe against the original; **Undo remains disabled** until Apply.
4. Keep current edit; verify neither saved recipe nor history changed.
5. Repeat, Apply; confirm history records the edit and Undo restores the original.
6. With known dark-subject and bright-background fixtures, verify high-confidence masks affect the subject only; low-confidence, clipped, oversized or malformed masks are rejected.
7. Repeat with real bird/aircraft/portrait frames. Label the results exploratory, not quality proof. Check small feathers and boundaries at 100%.
8. Run npm lint, unit, Playwright desktop/phone and Tauri macOS/Windows CI. If failures arise, separate regressions from failures already owned by another PR.

## Next after A passes

- Bring #323 back onto latest main after PR #325's focused crop/test work, resolve any conflicts and re-run all checks.
- Have Claude integrate and smoke-test the actual desktop installers; avoid competing editor-menu commits.
- In parallel advance TrueDetail via isolated high-precision quality modules and target real Z8/Z5II colour/HE samples **without uploading user photos or provisioned cloud training**.
- Use on-device ONNX inference by default. Evaluate LiteRT or other runtimes against measured quality/performance only; Vertex training remains optional, cost-gated and dependent on rights-cleared training data.

**Release rule:** No merge unless checks pass **and** Dave's authorised Chrome AI Studio session is ready to pull and verify immediately afterward. When blocked, choose an unrelated unclaimed valuable improvement instead of bypassing the gate.
