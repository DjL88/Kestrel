import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, CircleHelp, Sparkles } from 'lucide-react';
import { adviceAction, adviseOnPhoto, applySuggestion, type AdviceKey, type SceneContext, type Suggestion, type Verdict } from '../core/photoAdvice';
import type { SceneFacts } from '../core/photoCheck';
import { PHOTO_CHECK_TOTAL_BYTES } from '../core/photoCheckPack';
import type { GuidanceMode } from '../core/guidanceMode';
import type { Histogram } from '../core/histogram';
import { isNeutralEdit, type PhotoEdit } from '../core/photoEdits';
import { runPhotoCheck } from '../providers/photoCheck';
import { installPhotoCheck, photoCheckInstalled } from '../providers/photoCheckStore';
import { editorText as t } from '../i18n/areas/editor';

const ICON: Record<Verdict, typeof Check> = { good: Check, nearly: Sparkles, 'needs-work': CircleAlert, unsure: CircleHelp };
const IDLE_MS = 1500;

/** "Highlights ↓": the slider and the direction, as short as it can be. */
function describe(suggestion: Suggestion) {
  const [key, delta] = Object.entries(suggestion.changes)[0] as [AdviceKey, number];
  return { arrow: delta < 0 ? '↓' : '↑', name: t.advice.sliders[key], word: delta < 0 ? t.advice.lower : t.advice.raise };
}
/** What the model understood may only make the advisor more cautious. */
function contextFrom(facts: SceneFacts | null): SceneContext {
  if (!facts?.light) return {};
  return facts.light === 'low-key' || facts.light === 'high-key' ? { intent: facts.light } : { light: facts.light };
}
const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/**
 * Offline photo advice for the editor: a verdict word, one reason and ONE "Try this" (Glide), the same plus measured
 * high-confidence changes applied "Auto" with Undo (Soar), or "Check my photo" on request only (Fly Solo).
 *
 * The advice is measured from the picture on screen. If the on-device vision model has been installed (explicit consent,
 * nothing uploaded) it also reads the scene, which can only stop a deliberate look being "fixed". Fly Solo never runs the
 * model unless asked. Nothing is applied over the photographer's own edits.
 */
export function PhotoAdvice({ histogram, edit, mode, photoKey, disabled, onEdit, readPreview }: {
  histogram: Histogram | null; edit: PhotoEdit; mode: GuidanceMode; photoKey: string;
  disabled?: boolean; onEdit: (edit: PhotoEdit) => void; readPreview: () => HTMLCanvasElement | null;
}) {
  const [asked, setAsked] = useState(false);
  const [undo, setUndo] = useState<PhotoEdit | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'installing' | 'checking' | 'failed'>('idle');
  const [percent, setPercent] = useState(0);
  const [found, setFound] = useState<{ key: string; facts: SceneFacts } | null>(null);
  const autoDone = useRef(new Set<string>());
  const abort = useRef<AbortController | null>(null);
  const recipeKey = `${photoKey}|${JSON.stringify(edit)}`;
  const facts = found?.key === recipeKey ? found.facts : null; // a result for an older picture or recipe is stale and dropped

  useEffect(() => { void photoCheckInstalled().then(setInstalled, () => setInstalled(false)); }, []);
  useEffect(() => { setAsked(false); setUndo(null); setConsent(false); abort.current?.abort(); }, [photoKey, mode]);
  useEffect(() => () => abort.current?.abort(), []);

  const advice = useMemo(() => histogram ? adviseOnPhoto(histogram, edit, contextFrom(facts)) : null, [histogram, edit, facts]);
  const action = advice ? adviceAction(mode, advice, { asked, manuallyRefined: !isNeutralEdit(edit) && !autoDone.current.has(photoKey) }) : null;

  async function check() {
    const preview = readPreview();
    if (!preview || phase === 'checking') return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase('checking');
    try {
      const result = await runPhotoCheck(preview, controller.signal);
      if (!controller.signal.aborted) { setFound({ key: recipeKey, facts: result.facts }); setPhase('idle'); }
    } catch { if (!controller.signal.aborted) setPhase('failed'); else setPhase('idle'); }
  }
  // Glide and Soar: read the scene once the picture and recipe have been still for a moment. Fly Solo: never unprompted.
  useEffect(() => {
    if (mode === 'solo' || !installed || disabled || !histogram || found?.key === recipeKey || phase !== 'idle') return;
    const timer = window.setTimeout(() => void check(), IDLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, installed, disabled, histogram, recipeKey, found, phase]);

  async function install() {
    const controller = new AbortController();
    abort.current = controller;
    setPhase('installing'); setPercent(0);
    try {
      await installPhotoCheck({ signal: controller.signal, onProgress: ({ received, total }) => setPercent(Math.round((received / total) * 100)) });
      setInstalled(true); setConsent(false); setPhase('idle');
      if (mode === 'solo') void check();
    } catch { setPhase(controller.signal.aborted ? 'idle' : 'failed'); }
  }

  // Soar: once per photo, only when it is untouched, only measured high-confidence changes. Always undoable.
  useEffect(() => {
    if (disabled || !action || !action.auto.length || autoDone.current.has(photoKey)) return;
    autoDone.current.add(photoKey);
    setUndo(edit);
    onEdit(action.auto.reduce(applySuggestion, edit));
  }, [action, disabled, photoKey, edit, onEdit]);

  if (!advice || !action) return null;
  if (mode === 'solo' && !asked) {
    return <button type="button" disabled={disabled} onClick={() => { setAsked(true); if (installed) void check(); }}
      className="min-h-10 w-full border-t border-white/10 px-1 text-left text-xs text-zinc-300 hover:text-white">{t.advice.check}</button>;
  }
  const Icon = ICON[advice.verdict];
  const next = action.tryThis ? describe(action.tryThis) : null;
  const reason = advice.issues.find((issue) => t.advice.notes[issue]);
  return (
    <section aria-label={t.advice.region} className="space-y-1 border-t border-white/10 px-1 py-1 text-xs text-zinc-200">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <span role="status" className="inline-flex items-center gap-1 font-medium"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{t.advice.verdict[advice.verdict]}</span>
        {reason && advice.verdict !== 'good' && <span className="text-zinc-400">{t.advice.notes[reason]}</span>}
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
      </div>
      {facts && (facts.subject || facts.light) && (
        <p className="text-zinc-400">{t.advice.scene}: {[facts.subject && t.advice.subjects[facts.subject], facts.light && t.advice.lights[facts.light]].filter(Boolean).join(' · ')}</p>
      )}
      {phase === 'checking' && (
        <p className="flex items-center gap-2 text-zinc-400" role="status">{t.advice.checking}
          <button type="button" className="min-h-9 underline hover:text-white" onClick={() => abort.current?.abort()}>{t.advice.cancel}</button></p>
      )}
      {phase === 'failed' && <p className="text-zinc-400" role="status">{t.advice.failed}</p>}
      {phase === 'installing' && (
        <p className="flex items-center gap-2 text-zinc-400" role="status">{t.advice.installing(`${percent}%`)}
          <button type="button" className="min-h-9 underline hover:text-white" onClick={() => abort.current?.abort()}>{t.advice.cancel}</button></p>
      )}
      {installed === false && phase !== 'installing' && (consent ? (
        <div className="space-y-1 text-zinc-300">
          <p>{t.advice.installNote(megabytes(PHOTO_CHECK_TOTAL_BYTES))}</p>
          <div className="flex gap-2">
            <button type="button" className="min-h-9 rounded border border-white/20 px-2 hover:bg-white/10" onClick={() => void install()}>{t.advice.installConfirm}</button>
            <button type="button" className="min-h-9 px-2 underline hover:text-white" onClick={() => setConsent(false)}>{t.advice.notNow}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="min-h-9 text-zinc-400 underline hover:text-white" onClick={() => setConsent(true)}>{t.advice.install}</button>
      ))}
    </section>
  );
}
