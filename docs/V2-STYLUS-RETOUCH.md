# InFlight V2 — stylus and non-destructive retouching

Status: proposed product behaviour; **not implemented** except isolated pointer input helpers in this PR.
Owner request: Apple Pencil/stylus tools for brush masking, image correction, colour pen + eyedropper, and clone.

## Existing verified starting points (23 Nov 2026)
- `src/core/maskTypes.ts` already stores brush mask strokes as normalised point pairs and a fixed radius, with edit sliders and validation; there is **no pressure per point** in the current recipe.
- `src/components/MaskOverlay.tsx` already draws manual paint/erase strokes, uses pointer capture, and commits them on up, but does not distinguish pen pressure from mouse or protect against palm input.
- `src/v2/engineClient/maskOps.ts` maps core masks to V2 layers and sliders. V2 mask adapter integration remains separately owned.
- `src/v2/ui/shell/Canvas.tsx` is currently a shared hot path owned by other workers. Do not modify until region is explicitly claimed.

## UI placement
- One **Retouch** tab/tool group in Adjust/Edit, not a second row of permanent canvas buttons; compact floating toolbar only while a tool is selected.
- Four tool modes: **Mask** (paint/erase local adjustment), **Heal** (spot/source texture repair), **Clone** (explicit source → destination), and **Colour** (sample → paint).
- Existing crop and all-formats operations must never treat a stylus gesture as pan/crop or artboard dragging when a retouch mode is active. Double tap to toggle eraser only where supported, with an ordinary on-screen switch as fallback.
- Left-handed toolbar placement, keyboard-accessible controls, visible tool state, colour-blind-safe mask outlines, and an unambiguous Exit/Done.
- Two-finger touch pan/zoom while pen is active; suppress single-finger palm paint. Finger painting is an explicit opt-in for no-pen devices.

## Behaviour and storage, in implementation order

### Slice A — Brush masking (first usable feature)
- Bridge pen PointerEvents to the existing mask overlay only when the mask tool is selected; pen hover never paints. Collect coalesced pointer events where available; capture stroke at pointer-down and commit once on pointer-up; discard on cancel.
- Brush radius remains set by Size. Pressure modulates **strength/opacity**, not radius. Include Size, Feather/Hardness, Flow, Paint/Erase and Show mask.
- Current brush stroke schema has no pressure samples. Before shipping pressure-sensitive results, version the persisted recipe and validate bounded per-point strength with backward compatibility; simply drawing variable-width preview without matching export would be a defect.
- Multi-resolution preview is acceptable but final render/export must match, on rotated/cropped images and at 100% pixel view.
- Do not overwrite existing mask grids; mask edit increments recipe revision and invalidates stale asynchronous subject refinement.

### Slice B — Eyedropper & colour pen
- Sample from the selected rendered image with a clear **display vs image-value** distinction; preserve colour-profile handling and avoid sampling CSS preview colours as if they were linear originals.
- Store strokes in their own non-destructive layer with sampled colour, opacity, blend, pressure, and image-space positions; not directly in the original pixels.
- Add Undo/Redo, visibility toggle, eraser, and replay in high-bit export. Default to subtle Colour blending and offer Normal separately.

### Slice C — Clone
- Explicitly select source point (Alt-click with mouse, long-press or **Set source** with Pencil), then paint target.
- Aligned/Fixed source with source-crosshair preview; store source/target geometry and stroke sequence in the edit recipe and use original-image coordinates.
- CPU/reference renderer first, then accelerated renderer. Edge, zoom, crop and colour-profile parity required.

### Slice D — Heal/correct
- Deterministic, locally computed spot repair using neighbourhood content. No generative inpainting; user preview and approval. Offer Clone fallback when repair confidence is low.
- Distinguish sensor-dust repair from larger content-aware object removal; latter is out of scope until explicitly approved.
- Persist repair source/target, radius, blend parameters; never silently save flattened edits.

## Compatibility and performance
- Apple Pencil features vary by iPad/model/browser. Pressure/tilt require runtime feature detection; no Pencil hover/double-tap/squeeze feature may be assumed available.
- Pointer Events: pen, mouse, and optional finger. Use `touch-action: none` only on an active drawing surface; native scrolling stays elsewhere.
- In all modes, one edit stroke = one undo/history step and original/RAW bytes remain immutable.
- Stylus input and mask preview must feel responsive with high-resolution Nikon files; batch previews; never send stylus points to cloud. Image analysis/retouch operates locally and offline.
- Mouse/trackpad parity on desktop and Android pen parity on tablets.

## Release gates
1. On an actual iPad with Apple Pencil: pressure range, palm touch while drawing, hover (where available), cancellation, finger gesture, orientation changes and edge-of-canvas drawing.
2. Desktop mouse and Android stylus: same saved work, undo and exported result.
3. Source unchanged byte-for-byte; relink, history, virtual copy, project reopening and 16-bit TIFF/JPEG export replay.
4. Pressure/opacity maths tests, pointer-event tests and visual export comparison at 100% including cropped/rotated images.
5. No browser-only simulated passes presented as physical Pencil UAT.

## Worker coordination
Claim individual functions/regions on #890 before modifying shared `Canvas.tsx` or mask UI. W2 owns original integrity and must approve recipe/export work. No automatic merge without device/browser and output parity evidence.
