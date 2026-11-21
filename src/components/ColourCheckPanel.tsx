import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Lightbulb, Palette } from 'lucide-react';
import { checkColour, type ColourFamily, type ColourFinding, type ColourReport, type Pixels, type Strength } from '../core/colourCheck';
import type { PhotoEdit } from '../core/photoEdits';
import { applyFix } from '../core/critique';
import { colourText as t } from '../i18n/areas/colour';
import { AiReviewPanel } from './AiReviewPanel';

export interface ColourPreview {
  before: Pixels;
  after: Pixels;
  /** The main subject, 0–1 per pixel, the same size as `after`. */
  subject?: Float32Array;
}

interface Props {
  edit: PhotoEdit;
  /** Draws the small before/after preview; null while the photo isn't ready. */
  readPreview: () => ColourPreview | null;
  /** Values that change whenever the picture does (always the same number of them), so the check reruns after edits settle. */
  version: readonly unknown[];
  onEdit: (edit: PhotoEdit) => void;
  disabled?: boolean;
  /** A 1,024-pixel JPEG of the edited photo, base64, for the optional second opinion from the person's own AI. */
  readJpeg?: () => string | null;
}

const names = (families: ColourFamily[]) => families.length > 1 ? t.and(t.family[families[0]], t.family[families[1]]) : t.family[families[0]] ?? '';
const strength = (value: Strength) => t.strength[value];

/** The sentence, and an optional one-click fix, for a finding. Fixes go through the normal edit (undoable). */
function describe(finding: ColourFinding): { text: string; extra?: string; fix?: { label: string; delta: Partial<Record<keyof PhotoEdit, number>> } } {
  switch (finding.id) {
    case 'strongColour':
      return { text: t.strongColour(names(finding.families), Math.round(finding.share * 100)), fix: { label: t.fixSoften, delta: { colour: -0.3, vibrance: -0.2 } } };
    case 'clippedColour':
      return { text: t.clippedColour(names(finding.families)), fix: { label: t.fixSoften, delta: { colour: -0.3, vibrance: -0.2 } } };
    case 'cast': {
      const fix = finding.direction === 'warm' ? { label: t.fixCooler, delta: { warmth: finding.amount === 'clear' ? -0.4 : -0.2 } }
        : finding.direction === 'cool' ? { label: t.fixWarmer, delta: { warmth: finding.amount === 'clear' ? 0.4 : 0.2 } } : undefined;
      return { text: t.cast[finding.direction], extra: finding.amount === 'clear' ? t.castClear : undefined, fix };
    }
    case 'muted':
      return { text: t.muted };
    case 'redGreenAlike':
      return { text: t.redGreen(t.family[finding.families[0]], t.family[finding.families[1]]), extra: t.redGreenHint };
    case 'subjectColour':
      return { text: t.subject(t.family[finding.subject], strength(finding.subjectStrength), t.family[finding.surroundings]) };
    case 'editChange':
      return { text: finding.change > 0 ? t.editStronger(Math.round(finding.change * 100)) : t.editWeaker(Math.round(-finding.change * 100)) };
  }
}

const ICON = { warning: AlertTriangle, tip: Lightbulb, info: Info } as const;

/**
 * Colour check in the editor: the photo's main colours by name, and what may be wrong with them, in words with an icon
 * and a label (never colour alone). Runs on a small preview on this device; nothing is uploaded.
 */
export function ColourCheckPanel({ edit, readPreview, version, onEdit, disabled, readJpeg }: Props) {
  const [report, setReport] = useState<ColourReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [applied, setApplied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const read = useRef(readPreview);
  read.current = readPreview;

  useEffect(() => {
    if (disabled) return;
    // Wait for sliders to settle, then check a small preview.
    const timer = window.setTimeout(() => {
      try {
        const preview = read.current();
        if (!preview) return;
        setReport(checkColour({ after: preview.after, before: preview.before, subject: preview.subject }));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, refresh, ...version]);


  // Show the most consequential findings first; the full evidence remains available on request.
  const problems = report?.findings.filter((finding) => finding.severity !== 'info') ?? [];
  const important = [...(report?.findings ?? [])].sort((a, b) =>
    (a.severity === 'warning' ? 0 : a.severity === 'tip' ? 1 : 2) -
    (b.severity === 'warning' ? 0 : b.severity === 'tip' ? 1 : 2));
  const visible = showAll ? important : important.slice(0, 3);
  return (
    <details open className="border-t border-white/10" data-testid="colour-check">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
        <Palette className="h-4 w-4" aria-hidden="true" />{t.title}
        {problems.length > 0 && <span className="text-xs text-zinc-400">({t.findings(problems.length)})</span>}
      </summary>
      <div className="space-y-2 px-1 pb-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="min-h-11 rounded-md border border-white/15 px-3 text-xs text-zinc-200 focus-visible:outline-2 focus-visible:outline-sky-300" disabled={disabled} onClick={() => { setReport(null); setApplied(false); setRefresh((n) => n + 1); }}>Check now</button>
          <span className="text-xs text-zinc-400">On this device · preview assessment</span>
        </div>
        {failed && <p className="text-xs text-zinc-400">{t.unavailable}</p>}
        {!report && !failed && <p className="text-xs text-zinc-400">{t.checking}</p>}
        {report && report.palette.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-zinc-300">{t.mainColours}</h4>
            <ul className="mt-1 space-y-0.5" data-testid="colour-palette">
              {report.palette.map((entry) => (
                <li key={entry.family} className="flex items-center gap-2 text-xs text-zinc-200">
                  {/* A share bar (length, not colour) shows how much of the photo each colour covers. */}
                  <span aria-hidden="true" className="h-1.5 rounded-full bg-zinc-300" style={{ width: `${Math.max(4, Math.round(entry.share * 64))}px` }} />
                  {t.paletteItem(t.family[entry.family], strength(entry.strength), t.share(Math.round(entry.share * 100)))}
                </li>
              ))}
            </ul>
          </div>
        )}
        {report && (
          <ul className="space-y-2" data-testid="colour-findings">
            {report.findings.length === 0 && <li className="text-xs text-zinc-300">{t.nothingToFix}</li>}
            {visible.map((finding) => {
              const said = describe(finding);
              const Icon = ICON[finding.severity];
              const label = finding.severity === 'warning' ? t.watchOut : finding.severity === 'tip' ? t.tip : t.note;
              return (
                <li key={finding.id} data-finding={finding.id} className="space-y-1">
                  <p className="flex gap-1.5 text-xs text-zinc-200">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><strong className="font-semibold">{label}</strong> {said.text}<span className="sr-only"> Preview measurement or plausible hint, not proof of real-world colour.</span></span>
                  </p>
                  {said.extra && <details className="ml-5 text-xs text-zinc-300"><summary className="min-h-9 cursor-pointer py-2">Why?</summary><p>{said.extra}</p></details>}
                  {said.fix && !disabled && (
                    <button type="button" className="ml-5 min-h-9 rounded-md border border-white/15 px-2 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300"
                      onClick={() => { onEdit(applyFix(edit, { kind: 'global', delta: said.fix!.delta })); setApplied(true); }}>
                      Suggest adjustment
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {report && important.length > 3 && <button type="button" className="min-h-11 text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-300" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : "More findings"}</button>}
        {applied && <p role="status" className="text-xs text-zinc-400">{t.fixApplied}</p>}
        {readJpeg && <AiReviewPanel edit={edit} onEdit={onEdit} readJpeg={readJpeg} disabled={disabled}
          localFindings={report?.findings.map((finding) => describe(finding).text) ?? []} />}
      </div>
    </details>
  );
}
