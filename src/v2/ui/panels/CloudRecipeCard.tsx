import React from 'react';
import type { CloudRecipeOfferView } from '../contract';

/**
 * Co-pilot → Cloud edit settings (x-std-cloud-recipe, a preview that is off by default). The person sees what would be
 * sent, and its size, before anything leaves the device. Send uploads the 2,560 px smart preview; what comes back is a
 * few KB of edit settings applied as one step that Undo takes back. The full original is offered only when the
 * separate opt-in below is on, and only when it is estimated to be faster.
 */
export interface CloudRecipeCardProps {
  photoId: string;
  onPrepare: (photoId: string) => Promise<CloudRecipeOfferView>;
  onSend: (photoId: string, choice: 'send' | 'alternative') => Promise<string>;
  /** Turns the full-original opt-in on or off and returns what is in force afterwards. */
  onSetFullFile: (on: boolean) => boolean;
  /** The opt-in as it stands now. */
  fullFileOn: () => boolean;
}

const button = 'min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-left text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50';

export default function CloudRecipeCard({ photoId, onPrepare, onSend, onSetFullFile, fullFileOn }: CloudRecipeCardProps) {
  const [fullFile, setFullFile] = React.useState(fullFileOn);
  const [offer, setOffer] = React.useState<CloudRecipeOfferView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  React.useEffect(() => { setOffer(null); setMessage(''); }, [photoId]);

  const prepare = async () => {
    setBusy(true); setMessage('');
    try { setOffer(await onPrepare(photoId)); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not check this photo.'); }
    finally { setBusy(false); }
  };
  const send = async (choice: 'send' | 'alternative') => {
    setBusy(true);
    try { setMessage(await onSend(photoId, choice)); setOffer(null); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Nothing was changed.'); }
    finally { setBusy(false); }
  };
  const toggleFullFile = (on: boolean) => {
    const now = onSetFullFile(on);
    setFullFile(now);
    setOffer(null);
    setMessage(on && !now ? 'This device could not keep that choice, so full originals stay on this device.' : '');
  };

  return (
    <section aria-labelledby="cloud-recipe-heading" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5">
      <h3 id="cloud-recipe-heading" className="text-xs font-semibold text-[var(--text-primary)]">Cloud edit settings <span className="font-normal text-[var(--text-muted)]">(preview)</span></h3>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">
        Sends this photo's 2,560 px smart preview, not the original. The cloud sends back edit settings only, which you can undo. Its copy is deleted when the job ends.
      </p>
      {!offer && (
        <button type="button" disabled={busy} onClick={() => { void prepare(); }} className={`w-full ${button}`}>
          {busy ? 'Checking…' : 'Get cloud edit settings'}
        </button>
      )}
      {offer?.status === 'unavailable' && <p role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">{offer.message}</p>}
      {offer?.status === 'ready' && (
        <div className="space-y-2">
          <p className="text-[0.6875rem] text-[var(--text-primary)]">Nothing has been sent yet. Send the {offer.sendLabel}?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => { void send('send'); }} className={button}>Send {offer.sendLabel}</button>
            {offer.alternativeLabel && (
              <button type="button" disabled={busy} onClick={() => { void send('alternative'); }} className={button}>
                Send the {offer.alternativeLabel} instead (estimated faster)
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setOffer(null)} className={button}>Cancel</button>
          </div>
        </div>
      )}
      <label className="flex items-start gap-2 text-[0.6875rem] text-[var(--text-secondary)]">
        <input type="checkbox" checked={fullFile} disabled={busy} onChange={(event) => toggleFullFile(event.target.checked)}
          aria-describedby="cloud-recipe-full-file-note" className="mt-0.5" data-testid="cloud-recipe-full-file" />
        <span>
          Allow full originals to be sent
          <span id="cloud-recipe-full-file-note" className="block text-[var(--text-muted)]">Off unless you turn it on, and you can turn it off at any time. Offered only when it would be faster, always with its size first.</span>
        </span>
      </label>
      {message && <p role="status" aria-live="polite" className="text-[0.6875rem] text-[var(--text-secondary)]">{message}</p>}
    </section>
  );
}
