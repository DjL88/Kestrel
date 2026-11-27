import { shootTiers } from './shootTiers';
import { estimateCloudTask, type CloudUsage } from './cloudPlan';

/**
 * Cloud edits, chosen per project (Dave, 27 Nov): "Use the cloud for: Nothing (default) · Best only · Top 50 · All
 * photos". This is cloud PROCESSING: a copy of each chosen photo goes up, edit settings come back, the copy is deleted.
 * It is not cloud storage and not a backup. "Best" and "Top 50" follow Auto pick's own ranking (cullScore), so a photo
 * Auto pick has not scored is never guessed into them. Nothing is sent by choosing: the choice only says which photos a
 * run would cover, and a run still needs the person's one-time yes.
 */
export type CloudEditsChoice = 'none' | 'best' | 'top50' | 'all';
export const CLOUD_EDITS_CHOICES: readonly CloudEditsChoice[] = ['none', 'best', 'top50', 'all'];
export const CLOUD_EDITS_TOP = 50;

/** Anything unknown, also from an older or damaged project, is Nothing. */
export function parseCloudEditsChoice(value: unknown): CloudEditsChoice {
  return CLOUD_EDITS_CHOICES.includes(value as CloudEditsChoice) ? (value as CloudEditsChoice) : 'none';
}

interface Ranked { id: string; cullScore?: number; rating?: number; removedAt?: number | null }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The photos a cloud run should take first: eligible (not removed) photos only, best first. Stars first, then Auto
 * pick's cull score, then catalogue order. A photo with no score goes LAST but is never dropped. When the month's
 * usage is known the list is cut to what is left of the allowance, so a small allowance goes to the best photos
 * rather than to photos 1..N. Pure: nothing is sent.
 */
export function pickForCloud<T extends Ranked>(frames: readonly T[], usage?: Pick<CloudUsage, 'plan' | 'photosUsed' | 'balancePence'> | null): T[] {
  const ranked = frames.filter((frame) => frame.removedAt == null)
    .map((frame, order) => ({ frame, order }))
    .sort((a, b) => (finite(b.frame.rating) ? b.frame.rating : 0) - (finite(a.frame.rating) ? a.frame.rating : 0)
      || (finite(b.frame.cullScore) ? 1 : 0) - (finite(a.frame.cullScore) ? 1 : 0)
      || (finite(b.frame.cullScore) && finite(a.frame.cullScore) ? b.frame.cullScore - a.frame.cullScore : 0)
      || a.order - b.order)
    .map(({ frame }) => frame);
  if (!usage) return ranked;
  return ranked.slice(0, estimateCloudTask(ranked.length, usage).fromAllowance);
}

/** The photos a run would cover, best first. Removed photos are never included. */
export function cloudEditsPhotos(choice: CloudEditsChoice, frames: readonly Ranked[], usage?: Pick<CloudUsage, 'plan' | 'photosUsed' | 'balancePence'> | null): string[] {
  if (choice === 'none') return [];
  const kept = frames.filter((frame) => frame.removedAt == null);
  if (choice === 'all') return pickForCloud(kept, usage).map((frame) => frame.id);
  if (choice === 'top50') return pickForCloud(kept, usage).slice(0, CLOUD_EDITS_TOP).map((frame) => frame.id);
  const tiers = shootTiers(kept);
  return pickForCloud(kept.filter((frame) => tiers.get(frame.id) === 'best'), usage).map((frame) => frame.id);
}

/**
 * How a run would count against the month's cloud photos, before anything is sent. `used` and `monthly` are the
 * account's own numbers; when they are not known, only the count is given and nothing is estimated.
 */
export function cloudEditsAllowance(count: number, account?: { used: number; monthly: number } | null): { count: number; monthly?: number; left?: number; over: number } {
  if (!account || !(account.monthly > 0)) return { count, over: 0 };
  const left = Math.max(0, account.monthly - Math.max(0, account.used));
  return { count, monthly: account.monthly, left, over: Math.max(0, count - left) };
}
