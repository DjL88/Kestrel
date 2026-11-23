import type { Photo } from '../ui/contract';

/** What the filmstrip shows for the photos it was given, burst groups folded into one stack each. */
export type FilmstripItem =
  | { type: 'photo'; photo: Photo; stack?: { groupId: string; count: number; expanded: boolean } }
  | { type: 'controls'; groupId: string; count: number; best: Photo | null; cover: Photo };

type Burst = NonNullable<Photo['burst']>;

/** The suggested best frame: the highest measured score. Frames nobody has scored yet are never guessed at; with no scores there is no best. */
export function burstBest(members: readonly Photo[]): Photo | null {
  let best: Photo | null = null;
  for (const photo of members) {
    const score = photo.burst?.score;
    if (typeof score !== 'number') continue;
    if (!best || score > (best.burst?.score ?? -Infinity)) best = photo;
  }
  return best;
}

/**
 * Folds each burst (two or more photos that share a burst group and have not been split by the person) into one stack.
 * A collapsed stack shows only its cover (the best frame when one is measured, else the first); an expanded one shows every
 * frame in capture order, after a controls item. A group whose active or selected photo would otherwise be hidden is opened, so what
 * the person is working on is never hidden. The stack sits where its first frame was.
 */
export function planFilmstrip(photos: readonly Photo[], expanded: ReadonlySet<string>, alwaysOpen: ReadonlySet<string> = new Set()): FilmstripItem[] {
  const groups = new Map<string, Photo[]>();
  for (const photo of photos) {
    const burst = photo.burst;
    if (!burst || burst.ungrouped) continue;
    const list = groups.get(burst.groupId);
    if (list) list.push(photo); else groups.set(burst.groupId, [photo]);
  }
  const items: FilmstripItem[] = [];
  const done = new Set<string>();
  for (const photo of photos) {
    const burst: Burst | undefined = photo.burst;
    const members = burst && !burst.ungrouped ? groups.get(burst.groupId) : undefined;
    if (!burst || !members || members.length < 2) { items.push({ type: 'photo', photo }); continue; }
    if (done.has(burst.groupId)) continue;
    done.add(burst.groupId);
    const ordered = [...members].sort((a, b) => (a.burst?.index ?? 0) - (b.burst?.index ?? 0));
    const best = burstBest(ordered);
    const cover = best ?? ordered[0];
    // Only a photo that would be hidden inside a closed stack forces it open; the cover is always visible.
    const open = expanded.has(burst.groupId) || ordered.some((member) => member.id !== cover.id && alwaysOpen.has(member.id));
    if (!open) { items.push({ type: 'photo', photo: cover, stack: { groupId: burst.groupId, count: ordered.length, expanded: false } }); continue; }
    items.push({ type: 'controls', groupId: burst.groupId, count: ordered.length, best, cover });
    for (const member of ordered) items.push({ type: 'photo', photo: member, stack: { groupId: burst.groupId, count: ordered.length, expanded: true } });
  }
  return items;
}

