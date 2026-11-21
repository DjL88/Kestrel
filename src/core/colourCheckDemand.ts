import { samePhotoReviewScope, type PhotoReviewScope } from './photoReviewScope';

/** A synchronous gate, independent of React's deferred state updates. */
export class ColourCheckDemandGate {
  private inFlight = false;
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  begin(now: number): boolean {
    if (this.inFlight || now - this.lastStartedAt < 350) return false;
    this.inFlight = true;
    this.lastStartedAt = now;
    return true;
  }

  finish(): void {
    this.inFlight = false;
  }
}

/** A completed check can only publish against the exact photo/edit scope that requested it. */
export function acceptsColourCheck(
  startedGeneration: number,
  currentGeneration: number,
  requestedScope: PhotoReviewScope,
  currentScope: readonly unknown[],
): boolean {
  return startedGeneration === currentGeneration && samePhotoReviewScope(requestedScope, currentScope);
}
