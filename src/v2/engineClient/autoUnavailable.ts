import type { PhotoFrame } from '../../core/types';
import { v2Text } from '../../i18n/areas/v2';

/**
 * Why Auto (Co-pilot's on-device check, Auto-pilot) did not look at a photo. Before this, runAuto returned null and the
 * panel kept saying "nothing to report yet" forever, so a press of "Check photo on this device" appeared to do nothing.
 */
export type AutoUnavailableCause = 'no-preview' | 'raw-not-developed' | 'too-small' | 'failed';

export interface AutoUnavailable {
  unavailable: AutoUnavailableCause;
  /** The original this applies to; a relinked or changed original gets a fresh check. */
  source: Pick<PhotoFrame, 'stableKey' | 'originalSha256' | 'framing'>;
}

export function isAutoUnavailable(value: unknown): value is AutoUnavailable {
  return typeof value === 'object' && value !== null && 'unavailable' in value;
}

export function autoUnavailableMatches(result: AutoUnavailable, frame: PhotoFrame): boolean {
  return frame.removedAt == null && result.source.stableKey === frame.stableKey &&
    result.source.originalSha256 === frame.originalSha256 && result.source.framing === frame.framing;
}

/** Calm, plain sentences for the Co-pilot panel and the notice, in the person's language. Never claims an analysis that did not happen. */
export function autoUnavailableSentence(cause: AutoUnavailableCause, filename: string): string {
  const words = v2Text.autoCheck;
  switch (cause) {
    case 'raw-not-developed': return words.rawNotDeveloped(filename);
    case 'no-preview': return words.noPreview(filename);
    case 'too-small': return words.tooSmall(filename);
    case 'failed': return words.failed(filename);
  }
}
