/** Prevent superseded export proof renders from masquerading as current pixels. */
export interface PreviewRequestGate {
  /** Aborts the prior render and starts a new generation. */
  begin(): AbortSignal;
  /** Only the most recent, non-aborted generation may publish pixels or errors. */
  isCurrent(signal: AbortSignal): boolean;
  /** Unmount and effect cleanup cannot cancel a newer generation. */
  cancel(signal: AbortSignal): void;
}

/**
 * Independent of React and the renderer. The browser export composer accepts this
 * AbortSignal; identity checking is still needed when an old async renderer ignores
 * cancellation or finishes between two slider changes.
 */
export function createLatestPreviewRequest(): PreviewRequestGate {
  let active: AbortController | null = null;
  return {
    begin() {
      active?.abort();
      active = new AbortController();
      return active.signal;
    },
    isCurrent(signal) {
      return active?.signal === signal && !signal.aborted;
    },
    cancel(signal) {
      if (active?.signal !== signal) return;
      active.abort();
      active = null;
    },
  };
}
