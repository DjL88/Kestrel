import { AlertTriangle, Check, LoaderCircle, Sparkles } from 'lucide-react';
import { autoLabels as t } from '../i18n/autoLabels';

interface Props {
  analysing: boolean;
  disabled?: boolean;
  /** 0 to 1. */
  strength: number;
  verdict: 'improved' | 'looks-good' | 'cannot-improve-safely' | null;
  /** The recipe is previewed and waits for Apply (opt-in project assistance on first open). */
  pending: boolean;
  /** The strength slider still belongs to what is on the photo. */
  live: boolean;
  /** First entry is the headline; the rest is what was measured. */
  notes: string[];
  visionLine: string;
  comparing: boolean;
  onCompare: () => void;
  onAuto: () => void;
  onStrength: (value: number) => void;
  onStrengthCommit: () => void;
  onApply: () => void;
  onUndo: () => void;
}

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm';

/**
 * The one Auto control: a single button with a pulsing icon, beside a strength slider that scales the whole result.
 * The pulse only runs for people who have not asked for reduced motion, and never carries meaning on its own:
 * the label changes while working, the icon shape differs for each outcome, and the result is always written in words.
 */
export function AutoControl(p: Props) {
  const percent = Math.round(p.strength * 100);
  const Outcome = p.verdict === 'cannot-improve-safely' ? AlertTriangle : Check;
  return (
    <section aria-label={t.region} className="space-y-2 px-1" data-testid="auto-control">
      <div className="flex items-center gap-3">
        <button type="button" title={t.hint} disabled={p.disabled || p.analysing} aria-busy={p.analysing} data-testid="auto-button"
          onClick={p.onAuto}
          className={`${button} shrink-0 border border-white/10 bg-white/5 font-semibold hover:bg-white/10 disabled:cursor-wait`}>
          {p.analysing
            ? <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            : <Sparkles className="h-4 w-4 shrink-0 stroke-[1.75] motion-safe:animate-pulse" aria-hidden="true" />}
          {p.analysing ? t.analysing : t.auto}
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-zinc-300">
          <span className="shrink-0">{t.strength}</span>
          <input type="range" min={0} max={100} step={5} value={percent} data-testid="auto-strength"
            disabled={p.disabled || p.analysing || !p.live} aria-valuetext={t.strengthValue(percent)}
            onChange={(event) => p.onStrength(Number(event.target.value) / 100)}
            onPointerUp={p.onStrengthCommit} onKeyUp={p.onStrengthCommit} onBlur={p.onStrengthCommit}
            className="min-w-0 flex-1 accent-sky-300 disabled:opacity-40" />
          <output className="w-10 shrink-0 text-right tabular-nums">{t.strengthValue(percent)}</output>
        </label>
      </div>
      {p.notes.length > 0 && (
        <div role="status" className="space-y-1 text-xs text-zinc-300">
          <p className="flex items-start gap-1.5 text-sm text-zinc-100" data-testid="auto-headline">
            {p.verdict && <Outcome className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{p.verdict && <span className="font-semibold">{t.verdict[p.verdict]}. </span>}{p.notes[0]}</span>
          </p>
          {p.notes.length > 1 && (
            <details>
              <summary className="min-h-10 cursor-pointer py-2">{t.more}</summary>
              <ul className="list-disc space-y-1 pl-4">{p.notes.slice(1).map((note, index) => <li key={index}>{note}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {p.visionLine && (
        <p className="text-xs text-zinc-400"><span className="font-medium text-zinc-300">{t.vision}: </span>{p.visionLine} {t.visionNote}</p>
      )}
      {p.live && (
        <div className="flex flex-wrap gap-2">
          {p.pending && (
            <button type="button" className={`${button} bg-kestrel-copper font-semibold !text-zinc-950`} onClick={p.onApply}>{t.apply}</button>
          )}
          <button type="button" aria-pressed={p.comparing} className={`${button} border border-white/15 aria-pressed:bg-sky-300/15`}
            onClick={p.onCompare}>{p.comparing ? t.hideCompare : t.compare}</button>
          <button type="button" className={`${button} border border-white/15`} onClick={p.onUndo}>{p.pending ? t.keep : t.undo}</button>
        </div>
      )}
    </section>
  );
}
