/** Section F: the Photo Info panel should never consume the photo on a narrow
 * or short workspace by appearing automatically. This is intentionally more
 * conservative than the editor's two-column "workspace" breakpoint: a tool
 * dock plus a 280px Photo Info dock must still leave room for the image.
 *
 * Keep this query identical to the Tailwind "info-dock" custom variant.
 */
export const PHOTO_INFO_DOCK_QUERY =
  '((min-width: 1024px) and (min-height: 550px)) or ((min-width: 1280px) and (min-height: 440px))';

/** Deterministic counterpart for viewport policy tests, documentation and
 * layouts without matchMedia. Never decide by user-agent or device name.
 */
export function canDockPhotoInfo(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return (width >= 1024 && height >= 550) || (width >= 1280 && height >= 440);
}

export const FLOATING_PANE_Z = {
  // Owner decision (22 Nov 2026): undocked panels always sit in front of everything, dialogs
  // included (those are z-100), so their title bars stay reachable. Do not drop below 100.
  background: 110,
  foreground: 114,
  /** The lowest z-index a dialog may use; panels sit above it. */
  modalMinimum: 50,
} as const;
