import { STRINGS } from '../strings';
import type { OutboxSummary } from '../../../core/sharedOutbox';
import type { SharedEditingState } from './useSharedEditing';

/**
 * One calm line above the editing panels in a shared project. Words, never colour alone. Below it, when edits made on
 * this device are still waiting to be shared, or photos changed by someone else while offline need a choice, says so.
 */
export default function SharedEditBanner({ state, onKeepMine, onKeepTheirs, onKeepBoth, onRetry, outbox, onShowPhoto }: { state: SharedEditingState; onKeepMine: () => void; onKeepTheirs: () => void; onKeepBoth?: () => void; onRetry: () => void; outbox?: OutboxSummary; onShowPhoto?: (photoId: string) => void }) {
  const t = STRINGS.share;
  const text = state.kind === 'theirs' ? t.sharedTheirs(state.holder ?? t.sharedSomeone)
    : state.kind === 'mine' ? t.sharedMine
    : state.kind === 'draft' ? (state.reason === 'offline' ? t.sharedDraftOffline : t.sharedDraftLost)
    : state.kind === 'conflict' ? t.sharedConflict
    : state.kind === 'no-key' ? t.sharedNoKey
    : state.kind === 'view-only' ? t.sharedViewOnly(t.roles[state.role]) : null;
  // The outbox counts the other photos: the one on screen speaks for itself above.
  const otherConflicts = outbox?.conflictPhotoIds ?? [];
  const waiting = outbox?.waiting ?? 0;
  if (!text && !waiting && !otherConflicts.length) return null;
  const button = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs font-medium';
  return (
    <div role={state.kind === 'conflict' ? 'alert' : 'status'} data-testid="shared-edit-banner" data-state={state.kind}
      className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-hover)] p-2.5 text-xs">
      {text && <p>{text}</p>}
      {state.kind === 'conflict' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onKeepMine} className={button}>{t.sharedKeepMine}</button>
          <button type="button" onClick={onKeepTheirs} className={button}>{t.sharedKeepTheirs}</button>
          {onKeepBoth && <button type="button" onClick={onKeepBoth} className={button}>{t.sharedKeepBoth}</button>}
        </div>
      )}
      {state.kind === 'draft' && <button type="button" onClick={onRetry} className={`${button} mt-2`}>{t.sharedRetry}</button>}
      {waiting > 0 && (
        <div className={text ? 'mt-2' : ''} data-testid="shared-outbox-waiting">
          <p>{t.sharedOutboxWaiting(waiting)}</p>
          {state.kind !== 'draft' && <button type="button" onClick={onRetry} className={`${button} mt-2`}>{t.sharedRetry}</button>}
        </div>
      )}
      {otherConflicts.length > 0 && (
        <div className={text || waiting ? 'mt-2' : ''} data-testid="shared-outbox-conflicts">
          <p>{t.sharedOutboxConflicts(otherConflicts.length)}</p>
          {onShowPhoto && <button type="button" onClick={() => onShowPhoto(otherConflicts[0])} className={`${button} mt-2`}>{t.sharedOutboxShow}</button>}
        </div>
      )}
    </div>
  );
}
