import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { EXPORT_FORMATS, PLATFORMS, formatById, type BarStyle, type ExportFormat, type Fit } from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { PhotoFrame } from '../core/types';
import type { OverlayOptions } from '../core/exportOverlay';
import { ExportPreviewTile } from './ExportPreviewTile';
import { SocialIcon } from './SocialIcon';
import { exportText as t } from '../i18n/areas/export';
import { formatLabel, shapeName, sizeName } from '../i18n/areas/export/labels';

type Step = 'platform' | 'size' | 'position' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'platform', label: t.wizard.steps.platform }, { id: 'size', label: t.wizard.steps.size }, { id: 'position', label: t.wizard.steps.position }, { id: 'review', label: t.wizard.steps.review },
];
const FIT_LABELS: Record<Fit, string> = t.fit;
const field = 'min-h-10 w-full rounded-md border border-white/15 bg-[#15171C] px-2 text-base sm:text-sm';
const quiet = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-white/15 px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45';
const primary = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-kestrel-copper px-4 text-sm font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! disabled:opacity-45';

interface Props {
  frames: PhotoFrame[];
  sources: Record<string, HTMLImageElement>;
  chosen: string[];
  onToggle: (id: string, on: boolean) => void;
  customOn: boolean;
  onCustomOn: (on: boolean) => void;
  /** The custom size form. */
  customSlot: ReactNode;
  /** The formats as they will be made, with any turn, fit and name changes applied. */
  selected: ExportFormat[];
  fits: Record<string, Fit>;
  onFit: (id: string, fit: Fit) => void;
  bars: BarStyle;
  onBars: (bars: BarStyle) => void;
  anchorFor: (frame: PhotoFrame, format: ExportFormat) => FocusPoint;
  onAnchor: (frame: PhotoFrame, format: ExportFormat, anchor: FocusPoint) => void;
  zoomFor: (frame: PhotoFrame, format: ExportFormat) => number;
  onZoom: (frame: PhotoFrame, format: ExportFormat, zoom: number) => void;
  onTurn: (id: string) => void;
  overlay: OverlayOptions;
  overlaySlot: ReactNode;
  /** Date, borders, file names and the like, shown on the last step. */
  reviewSlot: ReactNode;
  busy: boolean;
  total: number;
  progress: number | null;
  blocked: boolean;
  onPrepare: () => void;
}

/** A small rectangle in the shape of a format, so sizes can be told apart at a glance. */
function ShapeGlyph({ width, height }: { width: number; height: number }) {
  const ratio = width && height ? width / height : 1;
  const box = ratio >= 1 ? { width: 28, height: Math.max(8, 28 / ratio) } : { width: Math.max(8, 28 * ratio), height: 28 };
  return <span className="grid h-8 w-8 shrink-0 place-items-center" aria-hidden="true"><span className="block rounded-[3px] border-2 border-zinc-300" style={box} /></span>;
}

/** Export as a short walk: where it is going, which size, where the crop sits, then export. */
export function ExportWizard(props: Props) {
  const { frames, selected, chosen } = props;
  const [step, setStep] = useState<Step>('platform');
  const [platform, setPlatform] = useState<string>('');
  const [index, setIndex] = useState(0);
  const [photo, setPhoto] = useState(0);
  // Always in the same order as the size list, however the choices were made, with a custom size last.
  const order = (format: ExportFormat) => { const at = EXPORT_FORMATS.findIndex((entry) => entry.id === format.id); return at < 0 ? EXPORT_FORMATS.length : at; };
  const positionable = selected.filter((format) => format.id !== 'master').sort((a, b) => order(a) - order(b));
  const current = positionable[Math.min(index, Math.max(0, positionable.length - 1))];
  const frame = frames[Math.min(photo, frames.length - 1)];
  const at = STEPS.findIndex((entry) => entry.id === step);
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stepKey = step === 'position' ? `position-${index}` : step;
  const previousStep = useRef(stepKey);

  useLayoutEffect(() => {
    if (previousStep.current === stepKey) return;
    previousStep.current = stepKey;
    if (content.current) content.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [stepKey]);

  useEffect(() => { if (step === 'size' && platform === 'custom') props.onCustomOn(true); }, [step, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const countFor = (id: string) => id === 'master' ? Number(chosen.includes('master')) : id === 'before-after' ? Number(chosen.includes('before-after')) : id === 'custom' ? Number(props.customOn)
    : EXPORT_FORMATS.filter((format) => format.platform === id && chosen.includes(format.id)).length;
  const choices = platform === 'master' ? [formatById('master')!] : platform === 'before-after' ? [formatById('before-after')!] : EXPORT_FORMATS.filter((format) => format.platform === platform);
  const platformName = platform === 'master' ? t.formats.fullSize : platform === 'before-after' ? t.formats.beforeAfter : platform === 'custom' ? t.formats.customSize : PLATFORMS.find((entry) => entry.id === platform)?.label ?? '';

  const next = () => {
    if (step === 'platform') return setStep('size');
    if (step === 'size') { setIndex(0); return setStep(positionable.length ? 'position' : 'review'); }
    if (step === 'position') return index < positionable.length - 1 ? setIndex(index + 1) : setStep('review');
    props.onPrepare();
  };
  const back = () => {
    if (step === 'size') return setStep('platform');
    if (step === 'position') return index > 0 ? setIndex(index - 1) : setStep('size');
    if (step === 'review') { setIndex(Math.max(0, positionable.length - 1)); return setStep(positionable.length ? 'position' : 'size'); }
  };
  const canNext = step === 'platform' ? Boolean(platform) : step === 'review' ? props.total > 0 && !props.busy && !props.blocked : props.total > 0 && !props.blocked;
  const nextLabel = step === 'review' ? (props.progress !== null ? t.wizard.preparing(props.progress, props.total) : t.prepare.files(props.total))
    : step === 'position' && index < positionable.length - 1 ? t.wizard.nextSize : t.wizard.next;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <ol aria-label={t.wizard.stepsLabel} className="flex items-center justify-center gap-1 text-xs text-zinc-400">
        {STEPS.map((entry, position) => (
          <li key={entry.id} aria-current={entry.id === step ? 'step' : undefined}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${entry.id === step ? 'bg-sky-300/20 text-sky-100' : position < at ? 'text-zinc-200' : ''}`}>
            <span className="tabular-nums">{position + 1}</span><span className={entry.id === step ? '' : 'max-sm:sr-only'}>{entry.label}</span>
          </li>
        ))}
      </ol>

      <div ref={content} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2">
        {step === 'platform' && (
          <section aria-label={t.wizard.where} className="space-y-2">
            <h3 ref={heading} tabIndex={-1} className="text-sm font-medium text-zinc-100">{t.wizard.where}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[{ id: 'master', label: t.formats.fullSize }, { id: 'before-after', label: t.formats.beforeAfter }, ...PLATFORMS, { id: 'custom', label: t.formats.customSize }].map((entry) => (
                <button key={entry.id} type="button" aria-pressed={platform === entry.id} onClick={() => { setPlatform(entry.id); setStep('size'); }}
                  className="relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-white/12 bg-white/5 px-2 text-sm text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300 aria-pressed:border-sky-300">
                  {entry.id === 'master' || entry.id === 'custom' || entry.id === 'before-after' ? <ShapeGlyph width={entry.id === 'master' ? 4 : entry.id === 'before-after' ? 2 : 1} height={entry.id === 'master' ? 3 : 1} /> : <SocialIcon id={entry.id as never} className="h-6 w-6" />}
                  {entry.label}
                  {countFor(entry.id) > 0 && <span className="absolute right-1.5 top-1.5 rounded-full bg-sky-300/25 px-1.5 text-xs text-sky-100">{countFor(entry.id)}</span>}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-400">{t.wizard.morePlaces}</p>
          </section>
        )}

        {step === 'size' && (
          <section aria-label={t.wizard.sizesLabel(platformName)} className="space-y-2">
            <h3 ref={heading} tabIndex={-1} className="text-sm font-medium text-zinc-100">{t.wizard.whichSize(platformName)}</h3>
            {platform === 'custom' ? props.customSlot : (
              <div className="space-y-1.5">
                {choices.map((format) => (
                  <label key={format.id} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-white/12 bg-white/5 px-3 hover:bg-white/10 has-[:checked]:border-sky-300">
                    <input type="checkbox" checked={chosen.includes(format.id)} onChange={(event) => props.onToggle(format.id, event.target.checked)} />
                    <ShapeGlyph width={format.width} height={format.height} />
                    <span className="min-w-0 flex-1"><span className="block text-sm">{formatLabel(format)}</span><span className="block text-xs text-zinc-400">{sizeName(format)}</span></span>
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        {step === 'position' && current && frame && (
          <section aria-label={t.wizard.steps.position} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 ref={heading} tabIndex={-1} className="text-sm font-medium text-zinc-100">{t.wizard.positionHeading(formatLabel(current))} <span className="font-normal text-zinc-400">{t.wizard.sizeOf(index + 1, positionable.length)}</span></h3>
              {frames.length > 1 && (
                <span className="flex items-center gap-1 text-xs text-zinc-300">
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10 disabled:opacity-40" aria-label={t.wizard.previousPhoto} disabled={photo === 0} onClick={() => setPhoto(photo - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                  {t.wizard.photoOf(photo + 1, frames.length)}
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10 disabled:opacity-40" aria-label={t.wizard.nextPhoto} disabled={photo >= frames.length - 1} onClick={() => setPhoto(photo + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                </span>
              )}
            </div>
            <div className="mx-auto max-w-md">
              <ExportPreviewTile key={`${frame.id}|${current.id}`} large frame={frame} source={props.sources[frame.id]} format={current} bars={props.bars}
                anchor={props.anchorFor(frame, current)} onAnchor={(anchor) => props.onAnchor(frame, current, anchor)}
                zoom={props.zoomFor(frame, current)} onZoom={(zoom) => props.onZoom(frame, current, zoom)}
                platform={current.platform} overlay={props.overlay} onTurn={() => props.onTurn(current.id)} />
            </div>
            {chosen.includes(current.id) && (
              <label className="block text-sm">{t.wizard.howItFits}
                <select className={`${field} mt-1`} value={props.fits[current.id] ?? current.fit} onChange={(event) => props.onFit(current.id, event.target.value as Fit)}>
                  {(Object.keys(FIT_LABELS) as Fit[]).map((fit) => <option key={fit} value={fit}>{FIT_LABELS[fit]}</option>)}
                </select>
              </label>
            )}
            {current.fit === 'bars' && (
              <label className="block text-sm">{t.borders.label}
                <select className={`${field} mt-1`} value={props.bars} onChange={(event) => props.onBars(event.target.value as BarStyle)}>
                  <option value="white">{t.borders.white}</option><option value="black">{t.borders.black}</option><option value="blur">{t.borders.blur}</option>
                </select>
              </label>
            )}
            {props.overlaySlot}
          </section>
        )}

        {step === 'review' && (
          <section aria-label={t.wizard.ready} className="space-y-3">
            <h3 ref={heading} tabIndex={-1} className="text-sm font-medium text-zinc-100">{t.wizard.ready}</h3>
            <ul className="space-y-1">
              {selected.map((format) => (
                <li key={format.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  {format.platform ? <SocialIcon id={format.platform} className="h-5 w-5 shrink-0 text-zinc-200" /> : <ShapeGlyph width={format.width} height={format.height} />}
                  <span className="min-w-0 flex-1"><span className="block truncate">{formatLabel(format)}</span><span className="block text-xs text-zinc-400">{sizeName(format)}{format.width ? ` · ${shapeName(format.width, format.height)}` : ''}</span></span>
                  <span className="text-xs text-zinc-400">× {frames.length}</span>
                  <button type="button" className="min-h-10 rounded-md px-2 text-xs text-zinc-300 underline underline-offset-4 hover:text-white" aria-label={t.wizard.removeFormat(formatLabel(format))}
                    onClick={() => (format.id === 'custom' ? props.onCustomOn(false) : props.onToggle(format.id, false))}>{t.wizard.remove}</button>
                </li>
              ))}
            </ul>
            <button type="button" className={quiet} onClick={() => setStep('platform')}><Plus className="h-4 w-4" aria-hidden="true" />{t.wizard.addPlace}</button>
            {frame && selected[0] && (props.overlay.on || props.overlay.watermark?.on) && (
              <div className="mx-auto max-w-md">
                <ExportPreviewTile key={`review-${frame.id}|${selected[0].id}`} large frame={frame}
                  source={props.sources[frame.id]} format={selected[0]} bars={props.bars}
                  anchor={props.anchorFor(frame, selected[0])} zoom={props.zoomFor(frame, selected[0])}
                  onAnchor={(anchor) => props.onAnchor(frame, selected[0], anchor)}
                  onZoom={(zoom) => props.onZoom(frame, selected[0], zoom)} overlay={props.overlay} />
              </div>
            )}
            {props.overlaySlot}
            {props.reviewSlot}
          </section>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 bg-kestrel-raised px-4 py-3 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button type="button" className={quiet} onClick={back} disabled={step === 'platform' || props.progress !== null}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t.wizard.back}</button>
        {step !== 'platform' && <button type="button" className={primary} onClick={next} disabled={!canNext}>{nextLabel}{step !== 'review' && <ArrowRight className="h-4 w-4" aria-hidden="true" />}</button>}
      </div>
    </div>
  );
}
