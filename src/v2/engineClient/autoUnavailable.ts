import type { PhotoFrame } from '../../core/types';

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

/** One calm, plain sentence for the Co-pilot panel and the notice. Never claims an analysis that did not happen. */
export function autoUnavailableSentence(cause: AutoUnavailableCause, filename: string): string {
  switch (cause) {
    case 'raw-not-developed':
      return `Auto has not checked ${filename}: it needs the RAW developed from its sensor data, and that is not available on this device right now (the original may be disconnected). Auto did not use the camera's embedded preview instead. Nothing was changed.`;
    case 'no-preview':
      return `Auto has not checked ${filename}: no picture of it could be read on this device. Reconnect the original and try again. Nothing was changed.`;
    case 'too-small':
      return `Auto has not checked ${filename}: the picture is too small to measure reliably. Nothing was changed.`;
    case 'failed':
      return `Auto could not finish checking ${filename}. Open Tasks for the detail. Nothing was changed.`;
  }
}
