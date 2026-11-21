# Kestrel icon system — proposed brand direction (21 November 2026)

## Principles
- A **restrained photographic instrument**, not a cartoon bird. A recognisable kestrel profile: hooked beak, narrow wings, long tail, perched silhouette. Never use a sparkle/magic wand to imply invented image content.
- All application controls use the existing Lucide React library, with **24×24 viewBox, 2px round stroke and joins, currentColor, no fills**. Avoid mixing stroke weights or hand-drawn illustrations in toolbars. Keep icons visually quiet; words carry the action.
- The approved **K logo remains authoritative**. The new `KestrelMotifIcon` is an exploratory supporting motif, not a replacement. Compare against the original vector K logo before any brand change; the supplied four reference drawings are visual inspiration, not exact logo source vectors.
- Size 16/20/24px as appropriate; touch target at least 44px even when the icon is 20px. Never use colour alone for selection. Keep labels and visible focus. The SVGs inherit theme colour.

## Flight guidance
| Mode | Icon | Text to display alongside it |
| --- | --- | --- |
| **Soar** | `SoarIcon`, rising wings | Gentle automatic improvements. Explicit opt-in, reversible. |
| **Glide** | `GlideIcon`, level wings | Quiet suggestions you can approve. Default. |
| **Fly Solo** | `FlySoloIcon`, perched bird | No unsolicited advice; help only when asked. |

The icon is *supporting information*, not a replacement for the label. No extra AI tab, wizard or persistent mascot. Avoid old driving-mode names in user-facing copy. Reuse existing translation strings and established settings rather than inventing another preference store.

## Application mapping
Use **standard Lucide** for Library (Images), Review (CheckSquare/flag labels), Edit (SlidersHorizontal), Masks (Layers), Colour (Blend), Crop (Crop), Detail (ScanEye or Focus), History (History), Export (Share), Settings (Settings), Search, Filter, Help and other utility actions. Do not draw bespoke bird icons for every operation; the three modes and optional brand identity are the only bird marks.

## Integration handoff — coordinator-owned shared UI
- Add Soar/Glide/Fly Solo components to the **existing** guidance selector after PR #670 is reconciled. Import from `src/components/icons/KestrelFlightIcons`; retain current labels, descriptions, local preference and undo logic.
- Keep all App/PhotoEditor/Settings/View menu edits with the integration owner. No extra toolbar row, no modal. Use mode icons in the selection control only, or a single subtle current-mode indicator where space allows.
- Check light/dark/contrast modes, British English, 20 supported locales, 320px mobile and keyboard/screen-reader interactions.
- This source PR is an icon library + contract, **not an installed application-wide icon replacement**. No source-image editing, upload or cloud activity.

## Acceptance and validation
Static source and branch review first. Then run repository unit tests, lint, build and Playwright; manually compare icon appearance against approved original K logo at 16, 20, 24 and 32px on desktop and mobile, dark/light backgrounds. Do not claim tests passed until executed. No photographic pipeline changes.
