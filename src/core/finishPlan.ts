import { isEmptyEdit, type PhotoEdit } from './photoEdits';

/**
 * "Finish my best" (owner, 27 Nov): say how many of the best photos to finish ("best 50", "best 10%", "best 200" or
 * "all") and the app edits them best first, in one batch. This file only CHOOSES the photos and their order. It never
 * edits, sends or removes anything, and it never drops a decision: a photo the person rejected, removed or already
 * edited is left out and counted, so the summary can say so.
 *
 * Ranking: stars first (the photographer's own rating, else the camera's), then the photographer's own Keep flag (as
 * the background queue, src/core/photoProcessingOrder.ts, treats it), then Auto pick's cull score, then capture order.
 * The cloud run (src/core/cloudEditsChoice.ts pickForCloud) orders by stars and score only, so it does not use a Keep
 * flag; this plan does. A photo with none of stars, Keep or a score is unranked: "best N" never guesses one in, so only
 * "all" takes it, last.
 */
export type FinishRequest =
  | { kind: 'count'; count: number }
  | { kind: 'percent'; percent: number }
  | { kind: 'all' };

/** What this file needs to know about a photo. A PhotoFrame satisfies it. */
export interface FinishCandidate {
  id: string;
  sequenceIndex: number;
  rating?: number;
  cullScore?: number;
  removedAt?: number | null;
  decision?: string;
  edit?: PhotoEdit;
  editHistory?: { steps: readonly unknown[] };
  isDemo?: boolean;
  virtualCopy?: unknown;
  exif?: { rating?: number; rejectedByMetadata?: boolean; editStatus?: { kind?: string } };
}

/** The most "best N" photos one batch takes: more than this is "all", which is asked for by name. */
export const FINISH_MAX_COUNT = 5000;
export const FINISH_DEFAULT_COUNT = 50;
export const FINISH_DEFAULT_PERCENT = 10;

export interface FinishSummary {
  kind: FinishRequest['kind'];
  /** Photos the batch will finish. */
  chosen: number;
  /** The photos the request chose from: every photo still in the project. */
  of: number;
  /** In the chosen group but left alone, each for a reason the person can see. */
  edited: number;
  rejected: number;
  editedElsewhere: number;
  /** Photos with neither stars nor a score: never counted as "best". */
  unranked: number;
  /** What the person asked for, after the percentage is turned into a number of photos. */
  asked: number;
}

export interface FinishPlan<T extends FinishCandidate = FinishCandidate> {
  /** The photos to finish, best first. */
  items: T[];
  summary: FinishSummary;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The photographer's explicit stars (including clearing to none) win over the camera's. */
export function starsOf(frame: Pick<FinishCandidate, 'rating' | 'exif'>): number {
  const stars = frame.rating ?? frame.exif?.rating;
  return finite(stars) && Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : 0;
}

const hasEdit = (frame: FinishCandidate): boolean =>
  Boolean(frame.editHistory?.steps.length) || Boolean(frame.edit && !isEmptyEdit(frame.edit));
const isRejected = (frame: FinishCandidate): boolean => frame.decision === 'reject' || frame.exif?.rejectedByMetadata === true;
/** Stars, else 1 for a Keep flag with no stars (the photographer's own pick), else 0. */
const standing = (frame: FinishCandidate): number => {
  const stars = starsOf(frame);
  return stars > 0 ? 10 + stars : frame.decision === 'keep' ? 1 : 0;
};
const ranked = (frame: FinishCandidate): boolean => standing(frame) > 0 || finite(frame.cullScore);

/** Every photo still in the project, best first: stars, then Keep, then Auto pick's score, then capture order; unranked last. */
export function rankPhotos<T extends FinishCandidate>(frames: readonly T[]): T[] {
  return frames.filter((frame) => frame.removedAt == null && !frame.isDemo && !frame.virtualCopy)
    .slice()
    .sort((a, b) => standing(b) - standing(a)
      || (finite(b.cullScore) ? 1 : 0) - (finite(a.cullScore) ? 1 : 0)
      || (finite(b.cullScore) && finite(a.cullScore) ? b.cullScore - a.cullScore : 0)
      || a.sequenceIndex - b.sequenceIndex);
}

/** How many photos a request asks for out of `total`: a percentage rounds up so "best 10%" of 7 is one photo, never none. */
export function requestedCount(request: FinishRequest, total: number): number {
  if (total <= 0) return 0;
  switch (request.kind) {
    case 'all': return total;
    case 'count': return finite(request.count) ? Math.min(total, Math.min(FINISH_MAX_COUNT, Math.max(0, Math.floor(request.count)))) : 0;
    case 'percent': return finite(request.percent) ? Math.min(total, Math.ceil((Math.min(100, Math.max(0, request.percent)) / 100) * total)) : 0;
  }
}

/** 50 photos or 10%, whichever is smaller, so a big shoot starts with 50 and a small one with a tenth. */
export function defaultFinishRequest(total: number): FinishRequest {
  const tenth = requestedCount({ kind: 'percent', percent: FINISH_DEFAULT_PERCENT }, total);
  return tenth > 0 && tenth < FINISH_DEFAULT_COUNT
    ? { kind: 'percent', percent: FINISH_DEFAULT_PERCENT }
    : { kind: 'count', count: FINISH_DEFAULT_COUNT };
}

/**
 * The photos to finish, best first. The request is applied to the ranking FIRST and photos already edited, rejected or
 * edited in another app are dropped after, so "best 50" never quietly slides down to photo 51 when one of the best was
 * already done by hand. Asking again later for a bigger number finishes only the new ones.
 */
export function planFinish<T extends FinishCandidate>(frames: readonly T[], request: FinishRequest): FinishPlan<T> {
  const library = rankPhotos(frames);
  const asked = requestedCount(request, library.length);
  const pool = request.kind === 'all' ? library : library.filter(ranked);
  const picked = pool.slice(0, asked);
  const items: T[] = [];
  let edited = 0, rejected = 0, editedElsewhere = 0;
  for (const frame of picked) {
    if (isRejected(frame)) rejected += 1;
    else if (hasEdit(frame)) edited += 1;
    else if (frame.exif?.editStatus?.kind === 'edited-elsewhere') editedElsewhere += 1;
    else items.push(frame);
  }
  return {
    items,
    summary: { kind: request.kind, chosen: items.length, of: library.length, edited, rejected, editedElsewhere, unranked: library.length - library.filter(ranked).length, asked },
  };
}
