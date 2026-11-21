import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Lightbulb, Palette } from 'lucide-react';
import { checkColour, type ColourFamily, type ColourFinding, type ColourReport, type Pixels, type Strength } from '../core/colourCheck';
import type { PhotoEdit } from '../core/photoEdits';
import { applyFix } from '../core/critique';
import { capturePhotoReviewScope, samePhotoReviewScope, type PhotoReviewScope } from '../core/photoReviewScope';
import { acceptsColourCheck, ColourCheckDemandGate } from '../core/colourCheckDemand';
import { colourText as t } from '../i18n/areas/colour';
import { colourControls } from '../i18n/colourControls';
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
  const [storedReport, setReport] = useState<ColourReport | null>(null);
  const reportScope = useRef<PhotoReviewScope | null>(null);
  const currentScope = useRef<PhotoReviewScope>([]);
  currentScope.current = [disabled, ...version];
  // A colour fix must never belong to the previous frame on the render in
  // which source/edit props change, even before React runs effect cleanup.
  const report = samePhotoReviewScope(reportScope.current, currentScope.current) ? storedReport : null;
  const [failed, setFailed] = useState(false);
  const [applied, setApplied] = useState(false);
  // The edit a fix makes is itself a version change; the confirmation must survive that one change, not be wiped by it.
  const appliedByFix = useRef(false);
  const [checking, setChecking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const generation = useRef(0);
  // Synchronous lock: React state alone cannot stop two clicks before rerender.
  const demandGate = useRef(new ColourCheckDemandGate());
  const manualFrame = useRef<number | null>(null);
  const manualTimer = useRef<number | null>(null);
  const cancelManual = () => {
    if (manualFrame.current !== null) window.cancelAnimationFrame(manualFrame.current);
    if (manualTimer.current !== null) window.clearTimeout(manualTimer.current);
    manualFrame.current = null;
    manualTimer.current = null;
  };
  const read = useRef(readPreview);
  read.current = readPreview;

  useEffect(() => {
    // Invalidate every pending check when the image, recipe or guidance state changes.
    // A previous photo must never leave apparently current colour advice behind.
    const current = ++generation.current;
    cancelManual();
    demandGate.current.finish();
    const requested = capturePhotoReviewScope(currentScope.current);
    reportScope.current = null;
    setReport(null);
    setFailed(false);
    setApplied(appliedByFix.current);
    appliedByFix.current = false;
    setShowAll(false);
    setChecking(!disabled);
    if (disabled) return;
    const timer = window.setTimeout(() => {
      if (current !== generation.current) return;
      try {
        const preview = read.current();
        if (!preview) {
          setReport(null);
          setFailed(true);
          setChecking(false);
          return;
        }
        const next = checkColour({ after: preview.after, before: preview.before, subject: preview.subject });
        if (current !== generation.current) return;
        if (!samePhotoReviewScope(requested, currentScope.current)) {
          // A new photo can render before the dependency effect runs. Do not
          // publish its predecessor's findings or leave the old check spinning.
          setChecking(false);
          return;
        }
        reportScope.current = requested;
        setReport(next);
        setFailed(false);
        setChecking(false);
      } catch {
        if (current !== generation.current) return;
        setReport(null);
        setFailed(true);
        setChecking(false);
      }
    }, 400);
    return () => {
      ++generation.current;
      window.clearTimeout(timer);
      cancelManual();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, ...version]);


  // Fly Solo never runs a background check. An explicit press uses the same local
  // renderer preview, and the normal version effect invalidates it on any edit/photo change.
  const checkOnDemand = () => {
    if (!demandGate.current.begin(Date.now())) return;
    const current = ++generation.current;
    const requested = capturePhotoReviewScope(currentScope.current);
    reportScope.current = null;
    setReport(null);
    setFailed(false);
    setApplied(false);
    setShowAll(false);
    cancelManual();
    setChecking(true);
    // Yield a frame and a task before CPU-bound local analysis. Without this,
    // synchronous pixel analysis prevents the busy state from ever painting.
    // The check remains entirely on-device, including in Fly Solo.
    manualFrame.current = window.requestAnimationFrame(() => {
      manualFrame.current = null;
      manualTimer.current = window.setTimeout(() => {
        manualTimer.current = null;
        try {
          if (!acceptsColourCheck(current, generation.current, requested, currentScope.current)) return;
          const preview = read.current();
          if (!acceptsColourCheck(current, generation.current, requested, currentScope.current)) return;
          if (!preview) { setFailed(true); return; }
          const next = checkColour({ after: preview.after, before: preview.before, subject: preview.subject });
          if (!acceptsColourCheck(current, generation.current, requested, currentScope.current)) return;
          reportScope.current = requested;
          setReport(next);
        } catch {
          if (acceptsColourCheck(current, generation.current, requested, currentScope.current)) setFailed(true);
        } finally {
          if (current === generation.current) setChecking(false);
          if (current === generation.current) demandGate.current.finish();
        }
      }, 0);
    });
  };

  const problems = report?.findings.filter((finding) => finding.severity !== 'info') ?? [];
  const important = report?.findings.filter((finding) => finding.severity !== 'info').slice(0, 3) ?? [];
  const visibleFindings = showAll ? report?.findings ?? [] : important;
  return (
    <details open className="border-t border-white/10" data-testid="colour-check">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
        <Palette className="h-4 w-4" aria-hidden="true" />{t.title}
        {problems.length > 0 && <span className="text-xs text-zinc-400">({t.findings(problems.length)})</span>}
      </summary>
      <div className="min-w-0 space-y-2 overflow-x-hidden px-1 pb-2 text-sm" aria-busy={!disabled && checking}>
        <button type="button" className="min-h-11 rounded-md border border-white/15 px-3 text-xs text-zinc-200 focus-visible:outline-2 focus-visible:outline-sky-300" onClick={checkOnDemand} aria-label={colourControls.check} aria-disabled={checking}>{colourControls.check}</button>
        {disabled && !report && !failed && <p className="text-xs text-zinc-400">{colourControls.paused}</p>}
        {failed && <p role="status" className="text-xs text-zinc-400">{t.unavailable} {colourControls.retry}</p>}
        {!disabled && checking && !report && !failed && !applied && <p role="status" className="text-xs text-zinc-400">{t.checking}</p>}
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
          <ul className="min-w-0 space-y-2" aria-label={colourControls.review} data-testid="colour-findings">
            {important.length === 0 && <li className="text-xs text-zinc-300">{t.nothingToFix}</li>}
            {visibleFindings.map((finding) => {
              const said = describe(finding);
              const Icon = ICON[finding.severity];
              const label = finding.severity === 'warning' ? t.watchOut : finding.severity === 'tip' ? t.tip : t.note;
              return (
                <li key={finding.id} data-finding={finding.id} className="space-y-1">
                  <p className="flex min-w-0 gap-1.5 break-words text-xs text-zinc-200">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><strong className="font-semibold">{label}</strong> {said.text}{said.extra ? ` ${said.extra}` : ''}</span>
                  </p>
                  {said.fix && (
                    <button type="button" className="ml-5 min-h-9 rounded-md border border-white/15 px-2 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300"
                      onClick={() => {
                        if (!samePhotoReviewScope(reportScope.current, currentScope.current)) return;
                        // Invalidate before notifying the parent: a double click or a slow
                        // parent render must not apply the same suggestion twice.
                        reportScope.current = null;
                        setReport(null);
                        appliedByFix.current = true;
                        setApplied(true);
                        onEdit(applyFix(edit, { kind: 'global', delta: said.fix!.delta }));
                      }}>
                      {said.fix.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {report && report.findings.length > important.length && (
          <button type="button" className="min-h-11 rounded-md px-2 text-xs text-zinc-300 underline focus-visible:outline-2 focus-visible:outline-sky-300" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? colourControls.fewer : colourControls.more}
          </button>
        )}
        {applied && <p role="status" className="text-xs text-zinc-400">{t.fixApplied}</p>}
        {readJpeg && !disabled && <AiReviewPanel edit={edit} onEdit={onEdit} readJpeg={readJpeg} version={version} disabled={disabled}
          localFindings={report?.findings.map((finding) => describe(finding).text) ?? []} />}
      </div>
    </details>
  );
}
