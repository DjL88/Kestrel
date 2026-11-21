import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, CircleHelp, Sparkles } from 'lucide-react';
import { adviceAction, adviseOnPhoto, applySuggestion, type AdviceKey, type SceneContext, type Suggestion, type Verdict } from '../core/photoAdvice';
import type { GuidanceMode } from '../core/guidanceMode';
import type { Histogram } from '../core/histogram';
import { isNeutralEdit, type PhotoEdit } from '../core/photoEdits';
import { editorText as t } from '../i18n/areas/editor';

const ICON: Record<Verdict, typeof Check> = { good: Check, nearly: Sparkles, 'needs-work': CircleAlert, unsure: CircleHelp };

/** "Highlights ↓": the slider and the direction, as short as it can be. */
function describe(suggestion: Suggestion) {
  const [key, delta] = Object.entries(suggestion.changes)[0] as [AdviceKey, number];
  return { arrow: delta < 0 ? '↓' : '↑', name: t.advice.sliders[key], word: delta < 0 ? t.advice.lower : t.advice.raise };
}

/**
 * Offline photo advice for the editor: a verdict word and ONE "Try this" (Glide), applied "Auto" with Undo (Soar),
 * or "Check my photo" on request (Fly Solo). Nothing is applied over the photographer's own edits.
 */
export function PhotoAdvice({ histogram, edit, mode, photoKey, scene, disabled, onEdit }: {
  histogram: Histogram | null; edit: PhotoEdit; mode: GuidanceMode; photoKey: string; scene?: SceneContext;
  disabled?: boolean; onEdit: (edit: PhotoEdit) => void;
}) {
  const [asked, setAsked] = useState(false);
  const [undo, setUndo] = useState<PhotoEdit | null>(null);
  const autoDone = useRef(new Set<string>());
  useEffect(() => { setAsked(false); setUndo(null); }, [photoKey, mode]);
  const advice = useMemo(() => histogram ? adviseOnPhoto(histogram, edit, scene) : null, [histogram, edit, scene]);
  const action = advice ? adviceAction(mode, advice, { asked, manuallyRefined: !isNeutralEdit(edit) && !autoDone.current.has(photoKey) }) : null;

  // Soar: once per photo, only when it is untouched, only measured high-confidence changes. Always undoable.
  useEffect(() => {
    if (disabled || !action || !action.auto.length || autoDone.current.has(photoKey)) return;
    autoDone.current.add(photoKey);
    setUndo(edit);
    onEdit(action.auto.reduce(applySuggestion, edit));
  }, [action, disabled, photoKey, edit, onEdit]);

  if (!advice || !action) return null;
  if (mode === 'solo' && !asked) {
    return <button type="button" disabled={disabled} onClick={() => setAsked(true)}
      className="min-h-10 w-full border-t border-white/10 px-1 text-left text-xs text-zinc-300 hover:text-white">{t.advice.check}</button>;
  }
  const Icon = ICON[advice.verdict];
  const next = action.tryThis ? describe(action.tryThis) : null;
  return (
    <section aria-label={t.advice.region} className="flex min-h-10 flex-wrap items-center gap-2 border-t border-white/10 px-1 py-1 text-xs text-zinc-200">
      <span role="status" className="inline-flex items-center gap-1 font-medium"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{t.advice.verdict[advice.verdict]}</span>
      {undo && (
        <button type="button" className="min-h-9 rounded px-2 text-zinc-300 underline hover:text-white" onClick={() => { onEdit(undo); setUndo(null); }}>
          {t.advice.autoApplied} · {t.advice.undo}
        </button>
      )}
      {next && action.tryThis && (
        <button type="button" disabled={disabled} aria-label={t.advice.tryLabel(`${next.word} ${next.name}`)}
          className="min-h-9 rounded border border-white/20 px-2 hover:bg-white/10"
          onClick={() => onEdit(applySuggestion(edit, action.tryThis!))}>
          {t.advice.tryThis} · {next.name} {next.arrow}
        </button>
      )}
    </section>
  );
}
