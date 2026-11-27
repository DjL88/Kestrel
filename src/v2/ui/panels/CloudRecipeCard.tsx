import React from 'react';
import type { CloudRecipeOfferView, CloudRecipeResultView, EditRecipe } from '../contract';
import { STRINGS } from '../strings';
import type { CloudConsentAnswer } from '../../../core/cloudConsent';
import { CloudJobError } from '../../../core/cloudJobProblem';

/**
 * Co-pilot → Cloud edit settings (x-std-cloud-recipe, a preview that is off by default). The person sees what would be
 * sent, and its size, before anything leaves the device. Send uploads the 2,560 px smart preview; what comes back is a
 * few KB of edit settings applied as one step that Undo takes back. The full original is offered only when the
 * separate opt-in below is on, and only when it is estimated to be faster.
 */
export interface CloudRecipeCardProps {
  photoId: string;
  onPrepare: (photoId: string) => Promise<CloudRecipeOfferView>;
  onSend: (photoId: string, choice: 'send' | 'alternative') => Promise<CloudRecipeResultView>;
  /** Shows the photo with these settings while "Hold to compare" is held; null puts it back. Absent: no compare. */
  onPreview?: (delta: Partial<EditRecipe> | null) => void;
  /** Turns the full-original opt-in on or off and returns what is in force afterwards. */
  onSetFullFile: (on: boolean) => boolean;
  /** The opt-in as it stands now. */
  fullFileOn: () => boolean;
  /**
   * The remembered answer to "Use InFlight's cloud for this?". Asked once, at the first Send, never pre-ticked; a yes
   * stays until the person changes it here. Absent (older callers, tests): every Send counts as the consent.
   */
  consent?: () => CloudConsentAnswer;
  onSetConsent?: (answer: 'yes' | 'no' | 'ask') => CloudConsentAnswer;
  /** Opens where the cloud balance is topped up. Shown only when a top-up would let the job go ahead. */
  onTopUp?: () => void;
}

const button = 'min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-left text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50';

const primary = 'min-h-10 rounded-[var(--radius-md)] border border-[var(--accent-primary)] bg-[var(--accent-primary)] px-3 text-left text-xs font-semibold text-[var(--text-on-accent,#fff)] disabled:opacity-50';

export default function CloudRecipeCard({ photoId, onPrepare, onSend, onSetFullFile, fullFileOn, consent, onSetConsent, onTopUp, onPreview }: CloudRecipeCardProps) {
  const [fullFile, setFullFile] = React.useState(fullFileOn);
  const [offer, setOffer] = React.useState<CloudRecipeOfferView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [needsTopUp, setNeedsTopUp] = React.useState(false);
  /** What the last job changed, and the old values for the compare. */
  const [result, setResult] = React.useState<CloudRecipeResultView | null>(null);
  const [comparing, setComparing] = React.useState(false);
  const [answer, setAnswer] = React.useState<CloudConsentAnswer>(() => consent?.() ?? 'yes');
  /** The choice waiting on the one-time question. */
  const [asking, setAsking] = React.useState<'send' | 'alternative' | null>(null);
  React.useEffect(() => { setOffer(null); setMessage(''); setNeedsTopUp(false); setAsking(null); setResult(null); }, [photoId]);
  // Never leave the photo showing its old settings: let go, a new photo, or the card going away all put it back.
  const previewRef = React.useRef(onPreview);
  previewRef.current = onPreview;
  React.useEffect(() => { if (!comparing) return; return () => previewRef.current?.(null); }, [comparing]);
  React.useEffect(() => () => setComparing(false), [photoId]);
  const holdCompare = (on: boolean) => {
    if (!result?.before || !onPreview) return;
    setComparing(on);
    onPreview(on ? result.before : null);
  };

  const prepare = async () => {
    setBusy(true); setMessage('');
    try { setOffer(await onPrepare(photoId)); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not check this photo.'); }
    finally { setBusy(false); }
  };
  const run = async (choice: 'send' | 'alternative') => {
    setBusy(true); setNeedsTopUp(false);
    try { const done = await onSend(photoId, choice); setMessage(done.message); setResult(done.changes?.length ? done : null); setOffer(null); } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Nothing was changed.');
      setNeedsTopUp(reason instanceof CloudJobError && reason.problem.topUp && Boolean(onTopUp));
    } finally { setBusy(false); }
  };
  // The first Send asks once; after a yes, Send goes straight ahead.
  const send = (choice: 'send' | 'alternative') => { if (answer === 'yes') void run(choice); else setAsking(choice); };
  const answerConsent = (yes: boolean) => {
    const choice = asking;
    setAsking(null);
    const now = onSetConsent?.(yes ? 'yes' : 'no') ?? (yes ? 'yes' : 'no');
    setAnswer(now);
    if (!yes) { setOffer(null); setMessage('Kept on this device. Nothing was sent.'); return; }
    if (now !== 'yes') { setMessage('This device could not keep your answer, so nothing was sent.'); return; }
    if (choice) void run(choice);
  };
  const forget = () => { setAnswer(onSetConsent?.('ask') ?? 'unasked'); setMessage(''); };
  const stop = () => { setAnswer(onSetConsent?.('no') ?? 'no'); setOffer(null); setMessage('Cloud edit settings are off on this device. Nothing will be sent.'); };
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
        Sends a copy of this photo at most 2,560 px across, not the original. The cloud sends back edit settings only, which you can undo. Its copy is deleted when the job ends.
      </p>
      {answer === 'no' && !offer && (
        <p className="text-[0.6875rem] text-[var(--text-secondary)]">
          You chose to keep this on your device.{' '}
          <button type="button" onClick={forget} className="underline">Ask me again</button>
        </p>
      )}
      {!offer && answer !== 'no' && (
        <button type="button" disabled={busy} onClick={() => { void prepare(); }} className={`w-full ${button}`}>
          {busy ? 'Checking…' : 'Get cloud edit settings'}
        </button>
      )}
      {offer?.status === 'unavailable' && <p role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">{offer.message}</p>}
      {offer?.status === 'ready' && asking && (
        <div role="group" aria-labelledby="cloud-consent-question" data-testid="cloud-consent" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
          <p id="cloud-consent-question" className="text-xs font-semibold text-[var(--text-primary)]">Use InFlight's cloud for this?</p>
          <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">
            InFlight sends the picture shown above to its servers, works out edit settings, then deletes its copy when the job ends. Your original stays on this device and is never changed.
            Each photo counts towards this month's cloud photos (Basic 500, Pro 5,000). After that each one is 0.3p from your cloud balance.
            You are asked once, and you can change your answer here at any time.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => answerConsent(true)} className={primary}>Yes, use the cloud</button>
            <button type="button" onClick={() => answerConsent(false)} className={button}>No, keep it on this device</button>
          </div>
        </div>
      )}
      {offer?.status === 'ready' && !asking && (
        <div className="space-y-2">
          <p className="text-[0.6875rem] text-[var(--text-primary)]">Nothing has been sent yet. Send the {offer.sendLabel}?</p>
          {offer.previewNote && <p data-testid="cloud-recipe-preview-note" className="text-[0.6875rem] text-[var(--text-secondary)]">{offer.previewNote}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => send('send')} className={button}>Send {offer.sendLabel}</button>
            {offer.alternativeLabel && (
              <button type="button" disabled={busy} onClick={() => send('alternative')} className={button}>
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
      {/* What the cloud changed, so its work is visible (Dave, 27 Nov), and a quick compare. The compare is here, beside
          the photo, never over it. */}
      {result?.changes && (
        <div data-testid="cloud-recipe-result" className="space-y-1.5">
          <p className="text-[0.6875rem] font-semibold text-[var(--text-primary)]">{STRINGS.cloudResult.changesHeading}</p>
          <p data-testid="cloud-recipe-changes" className="font-mono text-[0.6875rem] tabular-nums text-[var(--text-primary)]">{result.changes.join(' · ')}</p>
          {result.before && onPreview && (
            <button type="button" data-testid="cloud-recipe-compare" aria-pressed={comparing} aria-describedby="cloud-recipe-compare-hint"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); holdCompare(true); }}
              onPointerUp={() => holdCompare(false)} onPointerCancel={() => holdCompare(false)} onLostPointerCapture={() => holdCompare(false)}
              onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); holdCompare(true); } }}
              onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') holdCompare(false); }}
              onBlur={() => holdCompare(false)}
              className={button}>
              {STRINGS.cloudResult.holdCompare}
            </button>
          )}
          <p id="cloud-recipe-compare-hint" className="text-[0.625rem] text-[var(--text-muted)]">{STRINGS.cloudResult.holdCompareHint}</p>
        </div>
      )}
      {needsTopUp && onTopUp && <button type="button" onClick={onTopUp} className={button}>Top up</button>}
      {consent && answer === 'yes' && (
        <p className="text-[0.6875rem] text-[var(--text-muted)]">
          You said yes to using the cloud.{' '}
          <button type="button" onClick={stop} className="underline">Stop using the cloud</button>
        </p>
      )}
    </section>
  );
}
