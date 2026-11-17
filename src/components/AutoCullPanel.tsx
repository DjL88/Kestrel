import { tasks } from '../core/taskStore';
import { useEffect, useRef, useState } from 'react';
import { focusBeforeOpening, returnFocus } from './focusReturn';
import { X } from 'lucide-react';
import type { CullSuggestion } from '../core/autoCull';
import { planKeeperTier, type KeeperTier } from '../core/keeperTiers';
import { summarizeCullSuggestions } from '../core/autoCullSummary';
import type { PhotoFrame } from '../core/types';
import { messages as m, formatCount } from '../i18n/messages';
import { scanForCulling } from '../providers/browserAutoCull';
import { bundledModelUrl } from '../providers/bundledModelAssets';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

interface Props {
  frames: PhotoFrame[];
  keeperTarget: number;
  provider: BrowserPreviewProvider;
  onApply: (results: { frameId: string; decision: 'keep' | 'reject' }[]) => void;
  /** Every photo the scan looked at, with its confidence and score - recorded even when nothing was applied,
   * so a later "sort by culling confidence" has something to go on. */
  onScanned?: (results: { frameId: string; confidence: 'high' | 'medium' | 'low'; score: number }[]) => void;
  onUndo: () => void;
  onInspect: (frame: PhotoFrame) => void;
  /** Close this and show a collection in the library: the keepers, or what still needs a decision. */
  onShowCollection?: (filter: 'keep' | 'unreviewed') => void;
  onClose: () => void;
  /** Start the scan as soon as the panel opens, for projects that asked for auto-cull. */
  autoStart?: boolean;
}

const button = 'min-h-11 rounded-md px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45';

export function AutoCullPanel({ frames, keeperTarget, provider, onApply, onScanned, onUndo, onInspect, onShowCollection, onClose, autoStart }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef<AbortController | null>(null);
  const taskId = useRef<number | null>(null);
  const [autoMove, setAutoMove] = useState(true);
  const [keeperTier, setKeeperTier] = useState<KeeperTier>('better');
  const [lastAppliedCount, setLastAppliedCount] = useState(0);
  const [results, setResults] = useState<CullSuggestion[]>();
  const [applied, setApplied] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const previous = focusBeforeOpening();
    dialog.current?.showModal();
    return () => {
      if (taskId.current !== null) tasks.cancel(taskId.current);
      running.current = null;
      returnFocus(previous);
    };
  }, []);

  useEffect(() => {
    if (autoStart) void scan();
    // Only on opening: later changes to the photo list must not restart a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subjectDetectorAvailable = Boolean(bundledModelUrl('yolox_tiny.onnx'));
  const candidates = frames.filter((frame) => !frame.removedAt && frame.decision === 'unreviewed' && !frame.isDemo && !frame.virtualCopy);
  const summary = results ? summarizeCullSuggestions(results) : null;
  const high = (results ?? []).flatMap((result) =>
    result.confidence === 'high' && result.decision ? [{ frameId: result.frameId, decision: result.decision }] : []);
  const remaining = Math.max(0, keeperTarget - frames.filter((frame) => !frame.removedAt && frame.decision === 'keep').length);
  const tierPlan = results ? planKeeperTier(results, frames, keeperTarget, keeperTier) : [];

  function apply(moves: typeof high) {
    if (!moves.length) return;
    onApply(moves);
    setLastAppliedCount(moves.length);
    setApplied(true);
  }

  async function scan() {
    if (running.current) return;
    const controller = new AbortController();
    const task = tasks.start('Assisted culling', { total: candidates.length, cancel: () => controller.abort() });
    running.current = controller;
    taskId.current = task.id;
    setTotal(candidates.length);
    setProgress(0);
    setFailed(false);
    setStopped(false);
    try {
      const next = await scanForCulling(candidates, frames, provider, keeperTarget, controller.signal,
        (count) => { if (!controller.signal.aborted) setProgress(count); task.progress(count); });
      if (controller.signal.aborted) return;
      task.finish();
      setResults(next);
      onScanned?.(next.map((result) => ({ frameId: result.frameId, confidence: result.confidence, score: result.score })));
      if (autoMove) apply(next.flatMap((result) =>
        result.confidence === 'high' && result.decision ? [{ frameId: result.frameId, decision: result.decision }] : []));
    } catch {
      if (!controller.signal.aborted) { setFailed(true); task.fail('Could not finish looking at the photos'); }
    } finally {
      task.fail('Stopped before it finished'); // does nothing if it finished or was cancelled
      if (running.current === controller) {
        running.current = null;
        taskId.current = null;
        setProgress(undefined);
        setStopped(controller.signal.aborted);
      }
    }
  }

  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="auto-cull-title"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-xl border border-white/15 bg-kestrel-raised p-4 text-zinc-100 backdrop:bg-black/75">
      <header className="flex items-center justify-between">
        <h2 id="auto-cull-title" className="font-semibold">{m.autoCull}</h2>
        <button type="button" className={button} aria-label={m.closeAutoCull} title={m.closeAutoCull} onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></button>
      </header>
      <p className="text-sm text-zinc-300">{m.description}</p>
      {!subjectDetectorAvailable && (
        <p role="status" className="mt-2 rounded-md border border-white/12 p-2 text-xs text-zinc-300">
          This preview has no subject-detection model. You can still review photos and find exact duplicates;
          Kestrel will not automatically choose keepers from texture alone. Full desktop builds include the verified model.
        </p>
      )}
      {!results && <div className="mt-3 space-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={autoMove}
          disabled={progress !== undefined} onChange={(event) => setAutoMove(event.target.checked)} />{m.autoMove}</label>
        <button type="button" className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
          disabled={!candidates.length || progress !== undefined} onClick={() => void scan()}>
          {progress === undefined ? m.scan : m.scanning(formatCount.format(progress), formatCount.format(total))}
        </button>
        {progress !== undefined && <button type="button" className={button}
          onClick={() => { if (taskId.current !== null) tasks.cancel(taskId.current); }}>{m.stopScan}</button>}
        {!candidates.length && <p className="text-sm text-zinc-400">{m.noCandidates}</p>}
      </div>}
      {stopped && <p role="status" className="mt-2 text-sm text-zinc-300">{m.scanStopped}</p>}
      {failed && <p role="alert" className="mt-2 text-sm text-orange-200">{m.scanFailed}</p>}
      {results && <div className="mt-3 space-y-3">
        {summary && <section aria-label="Auto-cull summary" className="space-y-1 rounded-md border border-white/15 p-3 text-sm">
          <p className="font-semibold">Scan finished · {formatCount.format(summary.total)} photos</p>
          <p>{formatCount.format(summary.automaticKeep)} suggested keepers · {formatCount.format(summary.automaticDuplicate)} exact duplicates</p>
          <p>{formatCount.format(summary.needReview)} still need your review.</p>
          {summary.needReview > 0 && <p className="text-xs text-zinc-400">A target of {formatCount.format(keeperTarget)} keepers does not mean the other photos are automatically rejected. Uncertain photos stay in To review.</p>}
        </section>}
        {applied ? <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm">{m.moved(formatCount.format(lastAppliedCount))}</p>
          <button type="button" className={button} onClick={() => { onUndo(); setApplied(false); }}>{m.undo} last group</button>
        </div> : high.length > 0 ? <button type="button" className={button} onClick={() => apply(high)}>{m.applyHigh}</button> : null}
        {remaining > 0 && (
          <section className="space-y-2 rounded-lg border border-white/12 p-3" aria-label="Find more keeper candidates">
            <h3 className="text-sm font-semibold">Find more keepers</h3>
            <p className="text-xs text-zinc-300">{formatCount.format(frames.filter((frame) => !frame.removedAt && frame.decision === 'keep').length)} of {formatCount.format(keeperTarget)} target keepers. Wider suggestions help you choose, but Kestrel will not add weak shots to meet the number.</p>
            <div role="group" aria-label="Keeper suggestion quality" className="grid grid-cols-3 gap-1">
              {(['best', 'better', 'good'] as const).map((level) => (
                <button key={level} type="button" aria-pressed={keeperTier === level} onClick={() => setKeeperTier(level)}
                  className="min-h-11 rounded-md border border-white/15 px-2 text-sm capitalize aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">
                  {level === 'best' ? 'Best · strict' : level === 'better' ? 'Better' : 'Good · broader'}
                </button>
              ))}
            </div>
            <p role="status" className="text-xs text-zinc-300">
              {tierPlan.length ? `${tierPlan.length} additional ${tierPlan.length === 1 ? 'candidate' : 'candidates'} qualify for this level. Review them before accepting.` : 'No additional candidates qualify. You can review the other photos yourself.'}
            </p>
            {tierPlan.length > 0 && (
              <>
                <details className="rounded-md border border-white/10 px-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-xs text-zinc-300">Review {tierPlan.length} proposed keepers</summary>
                  <ul className="space-y-1 pb-2">
                    {tierPlan.map(({ frameId }) => {
                      const frame = frames.find((entry) => entry.id === frameId);
                      return frame ? <li key={frameId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs">{frame.filename}</span>
                        <button type="button" className={button} onClick={() => onInspect(frame)}>Inspect</button>
                      </li> : null;
                    })}
                  </ul>
                </details>
                <button type="button" className={`${button} border border-white/15 font-medium`}
                  onClick={() => apply(tierPlan)}>Keep {tierPlan.length} suggested {tierPlan.length === 1 ? 'photo' : 'photos'}</button>
              </>
            )}
          </section>
        )}
        {onShowCollection && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Where to next">
            <button type="button" autoFocus className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover!`}
              onClick={() => onShowCollection('keep')}>Show my keepers ({formatCount.format(frames.filter((frame) => !frame.removedAt && frame.decision === 'keep').length)})</button>
            {summary && summary.needReview > 0 && <button type="button" className={button} onClick={() => onShowCollection('unreviewed')}>Review the rest ({formatCount.format(frames.filter((frame) => !frame.removedAt && frame.decision === 'unreviewed').length)})</button>}
          </div>
        )}
        {/* The reasons for each photo, for anyone who wants them. Closed, so the dialog stays short. */}
        <details className="rounded-md border border-white/10 px-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-zinc-300">Why each photo was chosen</summary>
          {(['high', 'medium', 'low'] as const).map((level) => {
            const items = results.filter((result) => result.confidence === level);
            if (!items.length) return null;
            return <details key={level} className="rounded-md border border-white/10 px-2">
              <summary className="min-h-11 cursor-pointer py-2 text-sm">{m.confidence[level]} · {formatCount.format(items.length)}</summary>
              <ul className="divide-y divide-white/10">
                {items.map((result) => {
                  const frame = frames.find((entry) => entry.id === result.frameId);
                  if (!frame) return null;
                  return <li key={result.frameId} className="flex items-center justify-between gap-2 py-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{frame.filename}</p>
                      <p className="text-xs text-zinc-400">
                        {formatCount.format(result.score)}/100 · {result.decision === 'keep' ? m.keep : result.decision === 'reject' ? m.trash : m.review} · {m.reason[result.reason]}
                      </p>
                    </div>
                    <button type="button" className={`${button} shrink-0`} onClick={() => onInspect(frame)}>{m.reviewPhoto}</button>
                  </li>;
                })}
              </ul>
            </details>;
          })}
        </details>
      </div>}
    </dialog>
  );
}
