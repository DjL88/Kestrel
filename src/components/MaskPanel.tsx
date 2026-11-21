import { newId } from '../core/ids';
import { maskBlendLabels } from '../i18n/maskBlendLabels';
import type { GuidanceMode } from '../core/guidanceMode';
import { reviewMaskBlend, type MaskBoundaryEvidence } from '../core/maskBlendAdvice';
import { AdjustmentSlider } from './AdjustmentSlider';
import { Eraser, Paintbrush, Plus, Trash2 } from 'lucide-react';
import { ScanSearch, SquareDashedMousePointer } from 'lucide-react';
import { LOCAL_DETAIL_KEYS, LOCAL_KEYS, MAX_MASKS, createMask, type LocalKey, type Mask } from '../core/maskTypes';
import { viewerText as t } from '../i18n/areas/viewer';

const LABELS: Record<LocalKey, string> = t.mask.adjustments;
const KIND_NAMES = t.mask.kinds;

export function maskName(masks: Mask[], mask: Mask): string {
  const same = masks.filter((candidate) => candidate.kind === mask.kind && (candidate.kind !== 'subject' || candidate.invert === mask.invert));
  const base = mask.kind === 'subject' && mask.invert ? t.mask.background : KIND_NAMES[mask.kind];
  return t.mask.name(base, same.indexOf(mask) + 1);
}

interface Props {
  masks: Mask[];
  selectedId: string | null;
  disabled: boolean;
  brushRadius: number;
  paintOn: boolean;
  onPaintOn: (on: boolean) => void;
  erase: boolean;
  showOverlay: boolean;
  onSelect: (id: string | null) => void;
  onChange: (masks: Mask[]) => void;
  onBrushRadius: (radius: number) => void;
  onErase: (erase: boolean) => void;
  onShowOverlay: (show: boolean) => void;
  onFindSubject: (background: boolean) => void;
  onRefind: (id: string) => void;
  selectingArea: boolean;
  onSelectArea: (on: boolean) => void;
  detecting: boolean;
  detectNotice: string;
  currentFramingKey: string;
  guidanceMode?: GuidanceMode;
  boundaryEvidence?: MaskBoundaryEvidence | null;
  onBlendEdges?: (id: string) => void;
}

export function MaskPanel(props: Props) {
  const { masks, selectedId, disabled, brushRadius, erase, showOverlay, paintOn } = props;
  const selected = masks.find((mask) => mask.id === selectedId) ?? null;
  const blendAdvice = selected ? reviewMaskBlend(selected, props.guidanceMode ?? 'glide', props.boundaryEvidence) : null;
  const update = (patch: Partial<Mask>) => selected && props.onChange(masks.map((mask) => mask.id === selected.id ? { ...mask, ...patch } as Mask : mask));
  const add = (kind: Exclude<Mask['kind'], 'subject'>) => {
    const mask = createMask(kind, newId());
    props.onChange([...masks, mask]);
    props.onSelect(mask.id);
    props.onShowOverlay(true);
  };
  const chip = 'min-h-11 rounded-md border border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400 desk:min-h-9';
  return (
    <div className="space-y-2 px-1 pb-2">
      <p className="text-xs text-zinc-400">{t.mask.intro}</p>
      <div className="grid grid-cols-3 gap-1">
        {(['linear', 'radial', 'brush'] as const).map((kind) => (
          <button key={kind} type="button" disabled={disabled || masks.length >= MAX_MASKS} className={`${chip} inline-flex items-center justify-center gap-1`} onClick={() => add(kind)}>
            {kind === 'brush' ? <Paintbrush className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {KIND_NAMES[kind]}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" disabled={disabled || props.detecting || masks.length >= MAX_MASKS} className={`${chip} inline-flex items-center justify-center gap-1`} onClick={() => props.onFindSubject(false)}>
            <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />{props.detecting ? t.mask.finding : t.mask.findSubject}
          </button>
          <button type="button" disabled={disabled || props.detecting || masks.length >= MAX_MASKS} className={`${chip} inline-flex items-center justify-center gap-1`} onClick={() => props.onFindSubject(true)}>
            <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />{props.detecting ? t.mask.finding : t.mask.findBackground}
          </button>
        </div>
        <button type="button" aria-pressed={props.selectingArea} disabled={disabled || props.detecting || masks.length >= MAX_MASKS}
          className={`${chip} inline-flex w-full items-center justify-center gap-1 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} onClick={() => props.onSelectArea(!props.selectingArea)}>
          <SquareDashedMousePointer className="h-3.5 w-3.5" aria-hidden="true" />{props.selectingArea ? t.mask.cancelSelectArea : t.mask.selectArea}
        </button>
        <p role="status" className="min-h-4 text-xs text-zinc-300">{props.detectNotice}</p>
        <p className="text-xs text-zinc-400">{t.mask.modelNote}</p>
      </div>
      {masks.length > 0 && (
        <ul className="space-y-1" aria-label={t.mask.masks}>
          {masks.map((mask) => (
            <li key={mask.id} className="flex gap-1">
              <button type="button" aria-pressed={mask.id === selectedId} className={`${chip} min-w-0 flex-1 text-left aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`}
                onClick={() => props.onSelect(mask.id === selectedId ? null : mask.id)}>
                {mask.id === selectedId ? t.mask.editing(maskName(masks, mask)) : maskName(masks, mask)}
              </button>
              <button type="button" disabled={disabled} className={`${chip} w-11 shrink-0 px-0`} aria-label={t.mask.deleteMask(maskName(masks, mask))} title={t.mask.deleteThis}
                onClick={() => {
                  props.onChange(masks.filter((other) => other.id !== mask.id).map((other) => other.limit?.id === mask.id ? { ...other, limit: undefined } : other));
                  if (mask.id === selectedId) props.onSelect(null);
                }}>
                <Trash2 className="mx-auto h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="space-y-1 rounded-md border border-white/10 p-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={showOverlay} onChange={(event) => props.onShowOverlay(event.target.checked)} /> {t.mask.showOnPhoto}
          </label>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.invert} onChange={(event) => update({ invert: event.target.checked })} /> {t.mask.invert}
          </label>
          {selected.kind === 'radial' && (
            <AdjustmentSlider label={t.mask.ovalRotation} ariaLabel={t.mask.ovalRotationAria} value={selected.angle ?? 0}
              min={-180} max={180} neutral={0} step={1} disabled={disabled}
              displayValue={`${Math.round(selected.angle ?? 0)}°`}
              onChange={(value) => update({ angle: value })} />
          )}
          {selected.kind !== 'brush' && (
            <AdjustmentSlider label={t.mask.edgeSoftness} ariaLabel={t.mask.edgeSoftness} value={selected.feather}
              min={0} max={1} neutral={0} step={0.01} disabled={disabled} resettable={false}
              displayValue={`${Math.round(selected.feather * 100)}%`}
              onChange={(value) => update({ feather: value })} />
          )}
          {selected.kind === 'subject' && props.onBlendEdges && (
            <div className="space-y-1 rounded-md border border-white/10 p-2 text-xs text-zinc-300" data-testid="mask-blend">
              {blendAdvice && <p>{props.boundaryEvidence?.possibleHardEdge ? maskBlendLabels.boundary : maskBlendLabels.strong}</p>}
              <button type="button" className={chip}
                disabled={disabled || selected.framingKey !== props.currentFramingKey || !Object.values(selected.edit).some((value) => typeof value === 'number' && Number.isFinite(value) && value !== 0)}
                aria-label={maskBlendLabels.action}
                onClick={() => props.onBlendEdges?.(selected.id)}>{maskBlendLabels.action}</button>
              <details className="min-w-0 text-xs text-zinc-400">
                <summary className="min-h-11 cursor-pointer rounded-md py-3 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-300">{maskBlendLabels.why}</summary>
                <p className="break-words leading-relaxed">{maskBlendLabels.explanation}</p>
              </details>
            </div>
          )}
          {selected.kind === 'subject' && (
            <div className="space-y-1 rounded bg-black/20 p-2 text-xs text-zinc-300">
              <p>{t.mask.confidenceLabel} <strong>{t.mask.confidence[selected.confidence === 'high' ? 'high' : selected.confidence === 'medium' ? 'medium' : 'low']}</strong>.{' '}
                {t.mask.confidenceNote[selected.confidence === 'high' ? 'high' : selected.confidence === 'medium' ? 'medium' : 'low']}</p>
              {selected.framingKey !== props.currentFramingKey && (
                <p role="alert" className="font-semibold text-orange-200">{t.mask.framingChanged}</p>
              )}
              <button type="button" className={chip} disabled={props.detecting} onClick={() => props.onRefind(selected.id)}>{t.mask.findAgain}</button>
            </div>
          )}
          {(selected.kind === 'brush' || selected.kind === 'subject') && (
            <div className="space-y-1">
              <AdjustmentSlider label={t.mask.brushSize} ariaLabel={t.mask.brushSize} value={brushRadius}
                min={0.01} max={0.2} neutral={0.01} step={0.005} disabled={disabled} resettable={false}
                displayValue={String(Math.round(brushRadius * 200))}
                onChange={props.onBrushRadius} />
              <div className="flex gap-1">
                <button type="button" aria-pressed={paintOn && !erase} className={`${chip} flex-1 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} onClick={() => { const off = paintOn && !erase; props.onErase(false); props.onPaintOn(!off); }}>
                  <Paintbrush className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{selected.kind === 'subject' ? t.mask.add : t.mask.paint}
                </button>
                <button type="button" aria-pressed={paintOn && erase} className={`${chip} flex-1 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15`} onClick={() => { const off = paintOn && erase; props.onErase(true); props.onPaintOn(!off); }}>
                  <Eraser className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{selected.kind === 'subject' ? t.mask.remove : t.mask.erase}
                </button>
                <button type="button" className={chip} onClick={() => update({ strokes: [] })} disabled={!('strokes' in selected) || !selected.strokes.length}>{selected.kind === 'subject' ? t.mask.undoRefining : t.mask.clear}</button>
              </div>
              <p className="text-xs text-zinc-400">{paintOn ? t.mask.paintingOn : t.mask.paintingOff} {t.mask.paintingNeeds}</p>
            </div>
          )}
          {masks.length > 1 && (
            <label className="block text-xs text-zinc-300">
              {t.mask.combine}
              <select aria-label={t.mask.combine} value={selected.limit ? `${selected.limit.mode}:${selected.limit.id}` : 'none'}
                onChange={(event) => {
                  const [mode, ...rest] = event.target.value.split(':');
                  update({ limit: mode === 'none' ? undefined : { mode: mode as 'intersect' | 'subtract', id: rest.join(':') } });
                }}
                className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-kestrel-panel px-2 text-sm text-zinc-100">
                <option value="none">{t.mask.useWhole}</option>
                {masks.filter((other) => other.id !== selected.id).map((other) => (
                  <option key={`i${other.id}`} value={`intersect:${other.id}`}>{t.mask.intersectWith(maskName(masks, other))}</option>
                ))}
                {masks.filter((other) => other.id !== selected.id).map((other) => (
                  <option key={`s${other.id}`} value={`subtract:${other.id}`}>{t.mask.everywhereExcept(maskName(masks, other))}</option>
                ))}
              </select>
            </label>
          )}
          <div className="space-y-1 pt-1">
            {LOCAL_KEYS.map((key) => (
              <div key={key} className={key === LOCAL_DETAIL_KEYS[0] ? 'mt-2 border-t border-white/10 pt-2' : ''}>
                <AdjustmentSlider label={LABELS[key]} ariaLabel={t.mask.sliderFor(LABELS[key])}
                  value={selected.edit[key] ?? 0} min={key === 'denoise' ? 0 : -2} max={2} step={0.05} disabled={disabled}
                  onChange={(value) => update({ edit: { ...selected.edit, [key]: value } })} />
              </div>
            ))}
          </div>
          <button type="button" className={`${chip} inline-flex w-full items-center justify-center gap-1`}
            onClick={() => {
              props.onChange(masks.filter((mask) => mask.id !== selected.id).map((mask) => mask.limit?.id === selected.id ? { ...mask, limit: undefined } : mask));
              props.onSelect(null);
            }}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t.mask.deleteThis}
          </button>
        </div>
      )}
    </div>
  );
}
