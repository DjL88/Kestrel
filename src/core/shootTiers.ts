/**
 * The Info panel's Rank: each photo's place within its shoot, from Auto pick's own scores (cullScore).
 *
 * Auto pick scored every photo but nothing turned the scores into the three ranks the interface shows, so every real
 * photo said "Rank: Not ranked yet", also right after Auto pick had finished (owner's test, 27 Nov 2026). Only photos
 * Auto pick actually scored are ranked; a removed or unscored photo stays unranked, and so does a shoot with fewer than
 * three scored photos, where a rank within the shoot would say nothing. Nothing is guessed.
 */
export type ShootTier = 'best' | 'better' | 'good';

/** Share of the scored photos ranked "best" (at least one), and then "better". */
export const BEST_SHARE = 0.1;
export const BETTER_SHARE = 0.25;
export const MIN_RANKED = 3;

export function shootTiers(frames: ReadonlyArray<{ id: string; cullScore?: number; removedAt?: number | null }>): Map<string, ShootTier> {
  const scored = frames.filter((frame) => frame.removedAt == null && typeof frame.cullScore === 'number' && Number.isFinite(frame.cullScore));
  const tiers = new Map<string, ShootTier>();
  if (scored.length < MIN_RANKED) return tiers;
  // Highest score first; equal scores keep their shoot order, so the ranks are stable.
  const ranked = scored.map((frame, order) => ({ frame, order })).sort((a, b) => b.frame.cullScore! - a.frame.cullScore! || a.order - b.order);
  const best = Math.max(1, Math.round(ranked.length * BEST_SHARE));
  const better = best + Math.max(1, Math.round(ranked.length * BETTER_SHARE));
  ranked.forEach(({ frame }, index) => tiers.set(frame.id, index < best ? 'best' : index < better ? 'better' : 'good'));
  // Photos with the same score as the last "best" (or "better") photo get the same rank: a tie is never split.
  for (let i = 1; i < ranked.length; i += 1) {
    if (ranked[i].frame.cullScore === ranked[i - 1].frame.cullScore) tiers.set(ranked[i].frame.id, tiers.get(ranked[i - 1].frame.id)!);
  }
  return tiers;
}
