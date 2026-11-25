import { clampHealSpot, DEFAULT_HEAL_FEATHER, MAX_HEAL_RADIUS, MAX_HEAL_SPOTS, MIN_HEAL_RADIUS, type HealSource, type HealSpot } from '../../core/heal';
import type { HealSpotView } from '../ui/contract';

/** The spots stored on a photo, as the editor shows them. The radius and softness are shown 0 to 100. */
export function healToSpots(heal: readonly HealSpot[] | undefined): HealSpotView[] {
  return (heal ?? []).map((spot) => ({
    id: spot.id, x: spot.x, y: spot.y, sx: spot.sx, sy: spot.sy, r: spot.r, mode: spot.mode,
    size: radiusToSize(spot.r), feather: Math.round((spot.feather ?? DEFAULT_HEAL_FEATHER) * 100), visible: !spot.hidden,
  }));
}

/** The Size slider runs 1 to 100 over the allowed radius, on a square-root scale so small dust spots get fine control. */
export function sizeToRadius(size: number): number {
  const t = Math.min(1, Math.max(0, (size - 1) / 99));
  return Number((MIN_HEAL_RADIUS + (MAX_HEAL_RADIUS - MIN_HEAL_RADIUS) * t * t).toFixed(5));
}
export function radiusToSize(radius: number): number {
  const t = Math.sqrt(Math.min(1, Math.max(0, (radius - MIN_HEAL_RADIUS) / (MAX_HEAL_RADIUS - MIN_HEAL_RADIUS))));
  return Math.round(1 + 99 * t);
}

export const canAddHealSpot = (heal: readonly HealSpot[] | undefined) => (heal?.length ?? 0) < MAX_HEAL_SPOTS;

/** Add a spot copying from `source`. Nothing is added past the limit. */
export function addHealSpot(
  heal: readonly HealSpot[] | undefined, id: string, at: { x: number; y: number }, r: number, source: { sx: number; sy: number },
  mode: HealSpot['mode'] = 'heal',
): HealSpot[] {
  const spots = [...(heal ?? [])];
  if (!canAddHealSpot(spots) || spots.some((spot) => spot.id === id)) return spots;
  return [...spots, clampHealSpot({ id, x: at.x, y: at.y, sx: source.sx, sy: source.sy, r, mode })];
}

export interface HealSpotPatch { size?: number; feather?: number; mode?: HealSpot['mode']; source?: { sx: number; sy: number }; at?: { x: number; y: number }; visible?: boolean }

/** Change one spot. Size and softness come from the panel's 0 to 100 scale; invalid numbers leave the spot as it was. */
export function updateHealSpot(heal: readonly HealSpot[] | undefined, id: string, patch: HealSpotPatch): HealSpot[] {
  return (heal ?? []).map((spot) => {
    if (spot.id !== id) return spot;
    const next: HealSpot = { ...spot };
    if (patch.size !== undefined && Number.isFinite(patch.size)) next.r = sizeToRadius(patch.size);
    if (patch.feather !== undefined && Number.isFinite(patch.feather)) next.feather = Math.min(1, Math.max(0, Math.round(patch.feather) / 100));
    if (patch.mode === 'heal' || patch.mode === 'clone') next.mode = patch.mode;
    if (patch.source && Number.isFinite(patch.source.sx) && Number.isFinite(patch.source.sy)) { next.sx = patch.source.sx; next.sy = patch.source.sy; }
    if (patch.at && Number.isFinite(patch.at.x) && Number.isFinite(patch.at.y)) {
      // Moving the spot keeps its source at the same distance and direction, as a brush would.
      next.sx += patch.at.x - spot.x; next.sy += patch.at.y - spot.y;
      next.x = patch.at.x; next.y = patch.at.y;
    }
    if (patch.visible !== undefined) { if (patch.visible) delete next.hidden; else next.hidden = true; }
    return clampHealSpot(next);
  });
}

export const removeHealSpot = (heal: readonly HealSpot[] | undefined, id: string): HealSpot[] => (heal ?? []).filter((spot) => spot.id !== id);

/**
 * The next place to copy from after the current one, from the ranked list a search found: the first candidate clearly
 * apart from the current source, wrapping round. Null when there is nothing else to offer.
 */
export function nextHealSource(current: { sx: number; sy: number }, candidates: readonly HealSource[], r: number): HealSource | null {
  if (!candidates.length) return null;
  const index = candidates.findIndex((candidate) => Math.hypot(candidate.sx - current.sx, candidate.sy - current.sy) < r * 0.5);
  if (index === -1) return candidates[0];
  for (let step = 1; step < candidates.length; step += 1) {
    const candidate = candidates[(index + step) % candidates.length];
    if (Math.hypot(candidate.sx - current.sx, candidate.sy - current.sy) >= r * 0.5) return candidate;
  }
  return null;
}
