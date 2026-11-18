# TrueDetail: confidence-weighted masking roadmap (proposal)
Status: prototype; not connected to production RAW or export.

## Product behaviour
- Auto Develop presents a reversible suggested edit and an understandable "What changed?" summary.
- Default controls: Auto, strength, before/after. Optional Refine reveals subject/background, mask overlay, edge blend and manual correction.
- Never automatically delete, reject or overwrite an original. Preserve local/offline operation.
- Cloud guardian: opt-in only, reduced preview with metadata stripped, recommendations validated locally; no cloud dependency for editing.

## Engineering sequence
1. Separate semantic confidence, pixel coverage/opacity, and effect strength. Do not equate classifier scores with calibrated probabilities.
2. Edge-aware, full-resolution mask refinement for hair/feathers/translucent edges, with overlap-aware tiled processing and deterministic seams.
3. Linear-light, profile-aware pixel blending; preserve alpha and avoid colour-space mismatch. The prototype assumes caller-supplied common linear RGB space.
4. For spatial operators (denoise/sharpen), process with halo/overlap and guard against boundary ringing, noise discontinuity, false texture and oversharpening.
5. Subject-specific recipes: portrait skin/eyes/hair; bird eyes/feathers; background; landscapes. Constrain recovery of clipped highlights and shadow noise.
6. Add vectorscope and skin-hue reference in advanced analysis; do not force all complexions to one brightness or saturation.
7. Test synthetic ramps, fine strands, transparent boundaries, high ISO, dark images, saturated colour, 16-bit precision, tile seams and edit-history reversibility.
8. Validate Nikon Z8/Z5II lossless/HE/HE* separately with lawfully sourced fixtures; NX Studio colour/detail comparison requires independent references. No fidelity claim until verified.

## Initial isolated prototype
`src/core/truedetail/confidenceMask.mjs` is a pure, local, read-only Float32 RGBA blend helper with independent confidence/coverage/strength. It is not yet an edge-aware matting algorithm and does not replace the RAW pipeline.
Run: `node --test src/core/truedetail/confidenceMask.test.mjs`.
