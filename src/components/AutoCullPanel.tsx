import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CullSuggestion } from '../core/autoCull';
import type { PhotoFrame } from '../core/types';
import { messages as m, formatCount } from '../i18n/messages';
import { scanForCulling } from '../providers/browserAutoCull';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

interface Props {
  frames: PhotoFrame[];
  keeperTarget: number;
  provider: BrowserPreviewProvider;
  onApply: (results: { frameId: string; decision: 'keep' | 'reject' }[]) => void;
  onUndo: () => void;
  onInspect: (frame: PhotoFrame) => void;
  onClose: () => void;
}

const button = 'min-h-11 rounded-md px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45';

export function AutoCullPanel({ frames, keeperTarget, provider, onApply, onUndo, onInspect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef<AbortController | null>(null);
  const [autoMove, setAutoMove] = useState(true);
  const [results, setResults] = useState<CullSuggestion[]>();
  const [applied, setApplied] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    return () => running.current?.abort();
  }, []);

  const candidates = frames.filter((frame) => frame.decision === 'unreviewed' && !frame.isDemo && !frame.virtualCopy);
  const high = (results ?? []).flatMap((result) =>
    result.confidence === 'high' && result.decision ? [{ frameId: result.frameId, decision: result.decision }] : []);

  function apply(moves: typeof high) {
    if (!moves.length) return;
    onApply(moves);
    setApplied(true);
  }

  async function scan() {
    const controller = new AbortController();
    running.current = controller;
    setTotal(candidates.length);
    setProgress(0);
    setFailed(false);
    try {
      const next = await scanForCulling(candidates, frames, provider, keeperTarget, controller.signal,
        (count) => { if (!controller.signal.aborted) setProgress(count); });
      if (controller.signal.aborted) return;
      setResults(next);
      if (autoMove) apply(next.flatMap((result) =>
        result.confidence === 'high' && result.decision ? [{ frameId: result.frameId, decision: result.decision }] : []));
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setProgress(undefined);
    }
  }

  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="auto-cull-title"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-xl border border-white/15 bg-kestrel-raised p-4 text-zinc-100 backdrop:bg-black/75">
      <header className="flex items-center justify-between">
        <h2 id="auto-cull-title" className="font-semibold">{m.autoCull}</h2>
        <button type="button" className={button} aria-label={m.closeAutoCull} onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></button>
      </header>
      <p className="text-sm text-zinc-300">{m.description}</p>
      {!results && <div className="mt-3 space-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={autoMove}
          disabled={progress !== undefined} onChange={(event) => setAutoMove(event.target.checked)} />{m.autoMove}</label>
        <button type="button" className={`${button} bg-kestrel-copper text-zinc-950 hover:bg-kestrel-copper-hover`}
          disabled={!candidates.length || progress !== undefined} onClick={() => void scan()}>
          {progress === undefined ? m.scan : m.scanning(formatCount.format(progress), formatCount.format(total))}
        </button>
        {!candidates.length && <p className="text-sm text-zinc-400">{m.noCandidates}</p>}
      </div>}
      {failed && <p role="alert" className="mt-2 text-sm text-orange-200">{m.scanFailed}</p>}
      {results && <div className="mt-3 space-y-3">
        {high.length > 0 && (applied ? <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm">{m.moved(formatCount.format(high.length))}</p>
          <button type="button" className={button} onClick={() => { onUndo(); setApplied(false); }}>{m.undo}</button>
        </div> : <button type="button" className={button} onClick={() => apply(high)}>{m.applyHigh}</button>)}
        {(['high', 'medium', 'low'] as const).map((level) => {
          const items = results.filter((result) => result.confidence === level);
          if (!items.length) return null;
          return <details key={level} open={level === 'high'} className="rounded-md border border-white/10 px-2">
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
      </div>}
    </dialog>
  );
}
