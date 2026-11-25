import { STRINGS } from '../strings';
import type { SharedEditingState } from './useSharedEditing';

/** One calm line above the editing panels in a shared project. Words, never colour alone. */
export default function SharedEditBanner({ state, onKeepMine, onKeepTheirs, onKeepBoth, onRetry }: { state: SharedEditingState; onKeepMine: () => void; onKeepTheirs: () => void; onKeepBoth?: () => void; onRetry: () => void }) {
  const t = STRINGS.share;
  const text = state.kind === 'theirs' ? t.sharedTheirs(state.holder ?? t.sharedSomeone)
    : state.kind === 'mine' ? t.sharedMine
    : state.kind === 'draft' ? (state.reason === 'offline' ? t.sharedDraftOffline : t.sharedDraftLost)
    : state.kind === 'conflict' ? t.sharedConflict
    : state.kind === 'no-key' ? t.sharedNoKey
    : state.kind === 'view-only' ? t.sharedViewOnly(t.roles[state.role]) : null;
  if (!text) return null;
  const button = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs font-medium';
  return (
    <div role={state.kind === 'conflict' ? 'alert' : 'status'} data-testid="shared-edit-banner" data-state={state.kind}
      className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-hover)] p-2.5 text-xs">
      <p>{text}</p>
      {state.kind === 'conflict' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onKeepMine} className={button}>{t.sharedKeepMine}</button>
          <button type="button" onClick={onKeepTheirs} className={button}>{t.sharedKeepTheirs}</button>
          {onKeepBoth && <button type="button" onClick={onKeepBoth} className={button}>{t.sharedKeepBoth}</button>}
        </div>
      )}
      {state.kind === 'draft' && <button type="button" onClick={onRetry} className={`${button} mt-2`}>{t.sharedRetry}</button>}
    </div>
  );
}
