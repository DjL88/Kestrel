const CLOUD = 'M7 19.3a4.7 4.7 0 0 1-.8-9.3 6.3 6.3 0 0 1 12 1.5 3.9 3.9 0 0 1-.6 7.8z';

/** Drawn inline (the brand pack's cloud and cloud-off shapes) so the offline state shows without fetching an icon. */
function CloudIcon({ off, size = 17 }: { off: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="inline-block shrink-0">
      {off && (
        <mask id="inflight-cloud-off" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path d="M4 4l16 16" stroke="#000" strokeWidth="5.6" strokeLinecap="round" />
        </mask>
      )}
      <path d={CLOUD} fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
        mask={off ? 'url(#inflight-cloud-off)' : undefined} />
      {off && <path d="M4 4l16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}

export type CloudStatusState = 'offline' | 'reachable' | 'unreachable' | 'checking' | 'unknown';

/**
 * Top right of the home page and the editor: a small cloud that says whether the InFlight service can be reached,
 * in place of the old full-width "InFlight API · Connected · Check" bar. Connected shows a plain cloud; offline or
 * unreachable shows a crossed-out cloud with a short word beside it, so the state never rests on colour alone. The
 * full sentence is the button's label and tooltip, and pressing it checks again.
 */
export function CloudStatus({ state, label, detail, onCheck }: {
  state: CloudStatusState;
  /** One or two words: "Connected", "Offline", "Problem", "Not checked". */
  label: string;
  /** A sentence for the tooltip and screen readers. */
  detail: string;
  onCheck?: () => void;
}) {
  const down = state === 'offline' || state === 'unreachable';
  return (
    <button type="button" data-testid="cloud-status" data-state={state} role="status"
      aria-label={detail} title={detail} aria-busy={state === 'checking'}
      disabled={!onCheck || state === 'checking' || state === 'offline'} onClick={onCheck}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
      <span className={state === 'checking' || state === 'unknown' ? 'opacity-50' : undefined}>
        <CloudIcon off={down} />
      </span>
      {down && <span>{label}</span>}
    </button>
  );
}
