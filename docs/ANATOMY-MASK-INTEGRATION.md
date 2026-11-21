# Observed anatomy / occlusion integration contract (W3, 21 November)

This branch supplies a **pure, offline, non-generative** refinement of the existing `Mask.kind === 'subject'` recipe. It is **not** a deployed anatomy detector, not a confidence-calibrated model and not evidence of improved real-photo segmentation.

## End-user path to connect

1. W3/model lead: after existing U²-Net subject segmentation, optionally run a rights-cleared on-device part/foreground-occluder model on the *same framed image*. The model must produce two 8–512 pixel probability grids with matched framing, model ID/version and independently calibrated confidence. Bird legs/feet/wing tips, human hair/hands and pet paws/fur are examples of **observed** parts, not synthetic shapes; perches, branches and foreground objects are potential occluders. Never infer species from this generic detector.
2. W1/integration: verify the source SHA against the linked immutable original and framing key immediately before proposing a refinement. Call `refineObservedAnatomy` only when the optional model is present and trusted. On `ok:false`, retain the existing mask and show no success claim. On success, pass the returned mask through existing undoable recipe/history; do not mutate source or silently apply while a person is brushing. Preserve manual paint/erase strokes and mask limits. Revalidate the source before commit.
3. W2/RAW: reuse the same returned mask recipe through existing `effectiveAlpha` and true RGB16 renderer. Check real preview/export edge parity, high-frequency feather/branch halos and whether invalidated fine detail needs a new verified refinement at the updated grid resolution. This source-only patch intentionally clears stale fine detail; otherwise the old detail would override observed changes.
4. W4/UX: existing Masks tab only, quiet "Refine subject edges" suggestion when a trustworthy local model is installed; no new AI tab or forced wizard. Glide asks before applying; Soar may apply only if high-confidence, no manual mask conflict and undo is available; Fly Solo only on explicit request.

## Safety and validation

Both evidence maps must be calibrated on independent rights-cleared real positive/negative examples, including helicopters/aircraft, birds against branches, dark legs, humans/hair/hands, pets/paws, sports and non-subject landscapes. The current 0.90 confidence and 230/255 per-pixel gates are **conservative provisional engineering thresholds**, not calibrated accuracy. Existing manual strokes are retained, not discarded. No upload, generated pixels, training, commercial model rights or memory/performance claim. The input grids and output mask remain bounded to 512x512 cells.

Executable unit, lint, build, Playwright, Cargo, real Nikon, Mac/Windows/phone and 16-bit ICC/edge comparisons: NOT RUN in connector-only authoring. A real end-to-end improvement is NOT achieved until the existing segmentation producer, editor history and high-bit export are connected and verified. Keep #418 Q-04/Q-09/Q-10 open.
