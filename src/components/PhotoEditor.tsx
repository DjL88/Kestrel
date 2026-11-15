import { messages as m } from '../i18n/messages';
import { ChevronDown } from 'lucide-react';
import { DEFAULT_FRAMING, detailAnchor, drawFramedPhoto, estimateLevel, framedSize, thirdsCropAnchor, type PhotoFraming } from '../core/photoFraming';
import { PhotoExportPanel } from './PhotoExportPanel';
import { downloadExport } from '../providers/browserExport';
import { PhotoViewport } from './PhotoViewport';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EDIT, EDIT_CHOICES, applyCanvasPhotoEdit, isNeutralEdit, type PhotoEdit } from '../core/photoEdits';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

import { FIT_VIEW } from '../core/viewportTransform';
import { resolveKeyboardCommand, type KeyBindingsMap } from '../core/keyboardCommands';
import { visiblePhotoDetail } from '../core/visiblePhotoDetail';

const FIT_PREVIEW_EDGE = 2200;

interface Props {
  frame: PhotoFrame;
  provider: BrowserPreviewProvider;
  needsAccess: boolean;
  bindings: KeyBindingsMap;
  onEdit: (edit: PhotoEdit) => void;
  onHistoryStep: (direction: -1 | 1) => void;
  copiedEdit: PhotoEdit | null;
  onCopyEdit: (edit: PhotoEdit) => void;
  keeperCount: number;
  onCreateVirtualCopy: (framing?: PhotoFraming) => void;
  onFramingChange: (framing: PhotoFraming) => void;
  onRemoveVirtualCopy?: () => void;
  panelSide: 'left' | 'right';
  onPanelSideChange: (side: 'left' | 'right') => void;
  showFilmstrip: boolean;
  onToggleFilmstrip: () => void;
  onApplyToKeepers: (edit: PhotoEdit) => void;
  onUndoKeeperEdits?: () => void;
  onSubjectsChange: (names: string[]) => void;
}

export function PhotoEditor({
  frame, provider, needsAccess, bindings, onEdit, onHistoryStep, copiedEdit, onCopyEdit, keeperCount,
  onApplyToKeepers, onUndoKeeperEdits, onSubjectsChange, onCreateVirtualCopy, onRemoveVirtualCopy, onFramingChange,
  panelSide, onPanelSideChange, showFilmstrip, onToggleFilmstrip,
}: Props) {
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const editedCanvas = useRef<HTMLCanvasElement>(null);
  const sourceImage = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const originalDetail = useRef<HTMLCanvasElement>(null);
  const editedDetail = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [showDetail, setShowDetail] = useState(false);
  const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [compare, setCompare] = useState(false);
  const [dial, setDial] = useState(0);
  const [dialUsed, setDialUsed] = useState(false);
  const [quickChoices, setQuickChoices] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [previewCrop, setPreviewCrop] = useState(false);
  const [gridLines, setGridLines] = useState(true);
  const [cropNotice, setCropNotice] = useState('');
  const cropDrag = useRef<{ x: number; y: number; anchorX: number; anchorY: number } | null>(null);
  const [transform, setTransform] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [exportOpen, setExportOpen] = useState(false);
  const [subjectInput, setSubjectInput] = useState(() => frame.subjectNames?.join(', ') ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [editNotice, setEditNotice] = useState('');
  const edit = frame.edit ?? DEFAULT_EDIT;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const isRaw = /\.(nef|nrw)$/i.test(frame.filename) && !frame.isDemo;

  useEffect(() => {
    let active = true;
    const image = new Image();
    setSourceState('loading');
    sourceImage.current = null;

    async function load() {
      const url = await provider.getFullPreviewUrl(frame);
      if (!active) return;
      if (!url) throw new Error('Preview unavailable');
      image.src = url;
      await image.decode();
      if (!active) return;

      sourceImage.current = image;
      setSourceState('ready');
    }

    void load().catch(() => {
      if (active) setSourceState('error');
    });
    return () => { active = false; };
    // Catalogue edits replace the frame object while keeping the source for this ID.
  }, [frame.id, provider, needsAccess]);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const source = sourceState === 'ready' ? sourceImage.current : null;
  const guide = cropOpen && !previewCrop;
  const ratio = guide ? null : framing.ratio;
  const anchorX = guide ? 0.5 : framing.x;
  const anchorY = guide ? 0.5 : framing.y;
  const displayFraming = useMemo(() => ({
    ratio, x: anchorX, y: anchorY, turns: framing.turns, straighten: framing.straighten,
  }), [ratio, anchorX, anchorY, framing.turns, framing.straighten]);
  const displayCompare = compare && !guide && sourceState === 'ready';
  const outputSize = source ? framedSize(source.naturalWidth, source.naturalHeight, framing) : null;
  const size = source ? framedSize(source.naturalWidth, source.naturalHeight, displayFraming) : null;
  const fit = size ? Math.min(viewport.width / size.width, viewport.height / size.height) : 0;
  const position = size && fit ? {
    left: (viewport.width - size.width * fit) / 2, top: (viewport.height - size.height * fit) / 2,
    width: size.width * fit, height: size.height * fit,
  } : undefined;
  const cropRect = guide && outputSize && position ? {
    left: position.left + outputSize.x * fit, top: position.top + outputSize.y * fit,
    width: outputSize.width * fit, height: outputSize.height * fit,
  } : null;
  const detail = size ? visiblePhotoDetail(size.width, size.height, viewport.width, viewport.height, transform) : null;

  useEffect(() => {
    const canvas = editedCanvas.current;
    if (!source || !size || !canvas) return;
    const scale = Math.min(1, FIT_PREVIEW_EDGE / Math.max(size.width, size.height));
    drawFramedPhoto(source, canvas, displayFraming, { scale });
    applyCanvasPhotoEdit(canvas, edit);
  }, [source, displayFraming, edit, size?.width, size?.height]);

  useEffect(() => {
    if (!displayCompare || !source || !size || !originalCanvas.current) return;
    const scale = Math.min(1, FIT_PREVIEW_EDGE / Math.max(size.width, size.height));
    drawFramedPhoto(source, originalCanvas.current, displayFraming, { scale });
  }, [source, displayFraming, displayCompare, size?.width, size?.height]);

  useEffect(() => {
    setShowDetail(false);
    if (!source || !detail) return;
    const timer = window.setTimeout(() => {
      if (!editedDetail.current) return;
      const { region } = detail;
      const scale = Math.min(1, detail.scale * window.devicePixelRatio, Math.sqrt(5_000_000 / (region.width * region.height)));
      if (scale <= 0) return;
      drawFramedPhoto(source, editedDetail.current, displayFraming, { region, scale });
      applyCanvasPhotoEdit(editedDetail.current, edit);
      if (displayCompare && originalDetail.current) {
        drawFramedPhoto(source, originalDetail.current, displayFraming, { region, scale });
      }
      setShowDetail(true);
    }, 110);
    return () => window.clearTimeout(timer);
  }, [source, displayFraming, edit, displayCompare, transform, viewport]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || exportOpen || !source || event.key === 'Tab') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || target?.closest('textarea, select, input:not([type="range"])')) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ') {
        event.preventDefault();
        onHistoryStep(event.shiftKey ? 1 : -1);
        return;
      }
      const command = resolveKeyboardCommand({ event, bindings, activeMode: 'edit', isSuppressed: false });
      if (!command) return;
      event.preventDefault();
      const { key } = EDIT_CHOICES[dial];
      switch (command.id) {
        case 'edit.copy': onCopyEdit(edit); setEditNotice('Adjustments copied'); break;
        case 'edit.paste': if (copiedEdit) onEdit(copiedEdit); break;
        case 'edit.reset': onEdit(DEFAULT_EDIT); break;
        case 'edit.beforeAfter': if (!guide) setCompare((value) => !value); break;
        case 'edit.wbNeutral': onEdit({ ...edit, warmth: 0 }); break;
        case 'edit.prevControl':
          setDialUsed(true);
          setDial((index) => (index + 1) % EDIT_CHOICES.length);
          break;
        case 'edit.knobCcw':
        case 'edit.knobCw': {
          setDialUsed(true);
          const step = command.id === 'edit.knobCw' ? 0.1 : -0.1;
          const value = Math.max(-2, Math.min(2, Math.round((edit[key] + step) * 10) / 10));
          onEdit({ ...edit, [key]: value });
          break;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, copiedEdit, dial, edit, exportOpen, guide, onCopyEdit, onEdit, onHistoryStep, source]);

  function sampleOrientedSource() {
    if (!source) return null;
    const canvas = document.createElement('canvas');
    const oriented = { ...DEFAULT_FRAMING, turns: framing.turns };
    drawFramedPhoto(source, canvas, oriented, { scale: Math.min(1, 112 / Math.max(source.naturalWidth, source.naturalHeight)) });
    return canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
  }

  function createCropCopy() {
    const sample = sampleOrientedSource();
    if (!sample) return;
    const detail = detailAnchor(sample.data, sample.width, sample.height);
    const ratio = framing.ratio ?? (sample.height > sample.width ? 4 / 5 : 5 / 4);
    const anchor = thirdsCropAnchor(sample.width, sample.height, ratio, detail);
    onCreateVirtualCopy({ ...framing, ...anchor, ratio });
  }

  function autoLevel() {
    const sample = sampleOrientedSource();
    if (!sample) return;
    const correction = estimateLevel(sample.data, sample.width, sample.height);
    if (correction === null) {
      setCropNotice('No clear horizon or level line found.');
      return;
    }
    onFramingChange({ ...framing, straighten: correction });
    setCropNotice(correction ? `Straightened by ${correction}°` : 'The detected line is already level.');
  }

  const button = 'min-h-11 rounded-md px-3 text-sm text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400';
  return (
    <section aria-label="Photo editor" className="flex min-h-0 flex-1 flex-col bg-kestrel-stage lg:flex-row">
      <div ref={stage} className="relative flex min-h-0 flex-1 bg-black">
        <PhotoViewport zoom={transform.zoom} pan={transform.pan}
          onTransform={(zoom, pan) => setTransform({ zoom, pan })}
          overlayMode={displayCompare ? 'wipe' : 'hidden'}
          labels={['Original', 'Edited']}
          base={<>
            <canvas ref={editedCanvas} aria-label="Edited photo" role="img"
              hidden={sourceState !== 'ready'} className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && <canvas ref={editedDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
            {cropRect && <div aria-hidden="true" style={cropRect}
              className={`crop-guide absolute border border-white/90 ${gridLines ? 'crop-thirds' : ''} ${framing.ratio ? 'cursor-move' : 'pointer-events-none'}`}
              onPointerDown={(event) => {
                if (!framing.ratio) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                cropDrag.current = { x: event.clientX, y: event.clientY, anchorX: framing.x, anchorY: framing.y };
              }}
              onPointerMove={(event) => {
                if (!cropDrag.current || !size || !fit) return;
                const base = cropDrag.current;
                const bound = (value: number) => Math.max(0, Math.min(1, value));
                onFramingChange({
                  ...framing,
                  x: bound(base.anchorX + (event.clientX - base.x) / (size.width * fit * transform.zoom)),
                  y: bound(base.anchorY + (event.clientY - base.y) / (size.height * fit * transform.zoom)),
                });
              }}
              onLostPointerCapture={() => { cropDrag.current = null; }}
              onDoubleClick={(event) => event.stopPropagation()}
            />}
          </>}
          overlay={<>
            <canvas ref={originalCanvas} aria-label="Original photo" role="img"
              className={position ? "absolute" : "absolute inset-0 h-full w-full object-contain"} style={position} />
            {detail && displayCompare && <canvas ref={originalDetail} aria-hidden="true" hidden={!showDetail}
              className="absolute" style={detail.style} />}
          </>}
        />
        {sourceState !== 'ready' && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-300">
            {sourceState === 'loading' ? 'Opening photo…' : needsAccess ? 'Reconnect the original file to edit it.' : 'This photo has no browser-readable preview.'}
          </p>
        )}
      </div>
      <div className={`max-h-[44%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 bg-kestrel-panel p-3 lg:max-h-none lg:w-72 lg:border-t-0 lg:p-4 ${panelSide === 'left' ? 'lg:order-first lg:border-r' : 'lg:border-l'}`}>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={button} aria-pressed={displayCompare} disabled={sourceState !== 'ready' || guide} onClick={() => setCompare(!compare)}>
            Before / after
          </button>
          <button type="button" className={`${button} bg-kestrel-copper font-semibold !text-zinc-950 hover:bg-kestrel-copper-hover`}
            disabled={sourceState !== 'ready'} onClick={() => setExportOpen(true)}>
            Export
          </button>
        </div>
        {isRaw && <p className="text-xs text-zinc-300">Editing embedded JPEG preview</p>}
        <div className="space-y-2 px-1 py-2">
          {EDIT_CHOICES.map(({ key, label, options }, index) => (
            <fieldset key={key} disabled={sourceState !== 'ready'} className="min-w-0 disabled:opacity-45">
              <label className="block">
                <span className="flex items-center justify-between text-xs text-zinc-300">
                  <span>{label}{dialUsed && dial === index && <span className="ml-2 text-sky-200">Dial</span>}</span>
                  <output className="tabular-nums text-zinc-400">{key === 'exposure' ? `${(edit[key] * 0.4).toFixed(2)} EV` :
                    `${Math.round(edit[key] * (key === 'warmth' ? 8 : 20))}%`}</output>
                </span>
                <input type="range" min={-2} max={2} step={0.1} value={edit[key]} aria-label={`${label} adjustment`}
                  onFocus={() => setDial(index)}
                  onChange={(event) => onEdit({ ...edit, [key]: event.target.valueAsNumber })}
                  onDoubleClick={() => onEdit({ ...edit, [key]: 0 })}
                  className="block min-h-9 w-full accent-sky-300 lg:min-h-7" />
              </label>
              {quickChoices && <div className="flex gap-1">
                {options.map((name, index) => (
                  <button type="button" key={name} aria-pressed={edit[key] === index - 1}
                    onClick={() => onEdit({ ...edit, [key]: index - 1 })}
                    className="min-h-11 rounded px-2 text-xs hover:bg-white/8 aria-pressed:bg-sky-300/15 lg:min-h-7">{name}</button>
                ))}
              </div>}
            </fieldset>
          ))}
          <button type="button" aria-expanded={quickChoices} onClick={() => setQuickChoices(!quickChoices)}
            className="min-h-10 rounded-md px-1 text-xs text-zinc-400 hover:text-white lg:min-h-7">Quick choices</button>
        </div>
        <details className="border-t border-white/10"
          onToggle={(event) => {
            setCropOpen(event.currentTarget.open);
            setPreviewCrop(false);
            setTransform(FIT_VIEW);
          }}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm">Crop &amp; straighten</summary>
          <fieldset disabled={sourceState !== 'ready'} className="space-y-2">
            <div className="flex flex-wrap">
              <button type="button" className={button} onClick={createCropCopy}>Auto crop copy</button>
              <button type="button" className={button} onClick={() => onFramingChange({
                ...framing, turns: (framing.turns + 1) % 4, x: 1 - framing.y, y: framing.x,
              })}>Rotate 90°</button>
              <button type="button" className={button} onClick={autoLevel}>Auto-level</button>
              <button type="button" className={button} onClick={() => { onFramingChange(DEFAULT_FRAMING); setCropNotice(''); }}>Reset</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className={button} aria-pressed={previewCrop} onClick={() => {
                setPreviewCrop(!previewCrop);
                setTransform(FIT_VIEW);
              }}>{previewCrop ? 'Edit crop' : 'Preview crop'}</button>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={gridLines} onChange={(event) => setGridLines(event.target.checked)} />Gridlines</label>
            </div>
            {cropNotice && <p role="status" className="text-xs text-zinc-300">{cropNotice}</p>}
            <label className="flex min-h-11 items-center justify-between gap-2 text-sm">
              Aspect ratio
              <select value={framing.ratio ?? ''} onChange={(event) => onFramingChange({ ...framing, ratio: Number(event.target.value) || null })}
                className="min-h-10 rounded-md bg-[#252830] px-2">
                <option value="">Original</option>
                <option value={1}>Square</option>
                <option value={4 / 5}>4:5</option>
                <option value={5 / 4}>5:4</option>
                <option value={3 / 2}>3:2</option>
                <option value={9 / 16}>9:16</option>
                <option value={2 / 3}>2:3</option>
              </select>
            </label>
            <label className="block text-xs">Straighten <output>{framing.straighten.toFixed(1)}°</output>
              <input type="range" min={-12} max={12} step={0.1} value={framing.straighten}
                onChange={(event) => onFramingChange({ ...framing, straighten: event.target.valueAsNumber })}
                className="block min-h-10 w-full accent-sky-300" />
            </label>
            {framing.ratio && (['x', 'y'] as const).map((axis) => (
              <label key={axis} className="block text-xs">{axis === 'x' ? 'Horizontal crop position' : 'Vertical crop position'}
                <input type="range" min={0} max={1} step={0.01} value={framing[axis]}
                  onChange={(event) => onFramingChange({ ...framing, [axis]: event.target.valueAsNumber })}
                  className="block min-h-10 w-full accent-sky-300" />
              </label>
            ))}
          </fieldset>
        </details>
        <details className="border-t border-white/10">
          <summary className="min-h-11 cursor-pointer py-3 text-sm">{m.editHistory}</summary>
          {!frame.editHistory?.steps.length ? <p className="pb-2 text-sm text-zinc-400">{m.emptyHistory}</p> : (
            <>
              <div className="flex gap-2">
                <button type="button" className={button} disabled={!frame.editHistory.cursor} onClick={() => onHistoryStep(-1)}>{m.undo}</button>
                <button type="button" className={button} disabled={frame.editHistory.cursor >= frame.editHistory.steps.length}
                  onClick={() => onHistoryStep(1)}>{m.redo}</button>
              </div>
              <ol className="max-h-48 overflow-y-auto pb-2 text-sm">
                {frame.editHistory.steps.map((step, index) => <li key={index}
                  aria-current={index === frame.editHistory!.cursor - 1 ? 'step' : undefined}
                  className={`rounded px-2 py-1 ${index >= frame.editHistory!.cursor ? 'text-zinc-500' : 'text-zinc-200'} aria-[current=step]:bg-white/10`}>
                  {m.historyStep[step.kind]}
                </li>)}
              </ol>
            </>
          )}
        </details>
        <details className="border-t border-white/10">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-zinc-300 [&::-webkit-details-marker]:hidden">
            Edit options <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={sourceState !== 'ready'} className={button} onClick={() => {
              onCopyEdit(edit);
              setEditNotice('Adjustments copied');
            }}>Copy adjustments</button>
            <button type="button" disabled={!copiedEdit || sourceState !== 'ready'} className={button} onClick={() => {
              if (!copiedEdit) return;
              onEdit(copiedEdit);

              setEditNotice('Adjustments pasted');
            }}>Paste adjustments</button>
            <button type="button" disabled={isNeutralEdit(edit)} className={button} onClick={() => {
              onEdit(DEFAULT_EDIT);

              setEditNotice('Adjustments reset');
            }}>Reset edits</button>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-white/10 pt-1">
            <button type="button" disabled={keeperCount < 2 || isNeutralEdit(edit) || sourceState !== 'ready'}
              className={button} aria-expanded={confirmApply} onClick={() => setConfirmApply(!confirmApply)}>
              Apply to {keeperCount} keepers
            </button>
            {onUndoKeeperEdits && <button type="button" className={button} onClick={() => {
              onUndoKeeperEdits();
              setEditNotice('Batch adjustments undone');
            }}>Undo last batch</button>}
          </div>
          {confirmApply && !isNeutralEdit(edit) && sourceState === 'ready' && (
            <div className="rounded-md bg-black/25 p-2 text-sm">
              <p>Replace the adjustments on all {keeperCount} keepers with this photo’s settings?</p>
              <button type="button" className={button} onClick={() => setConfirmApply(false)}>Cancel</button>
              <button type="button" className={`${button} font-semibold`} onClick={() => {
                onApplyToKeepers(edit);
                setConfirmApply(false);
  
                setEditNotice(`Updated ${keeperCount} keepers`);
              }}>Apply adjustments</button>
            </div>
          )}
          <p role="status" className="text-xs text-zinc-400">{editNotice}</p>
          <div className="flex flex-wrap gap-1 border-t border-white/10 pt-1">
            <button type="button" className={button} onClick={() => onCreateVirtualCopy()}>Create virtual copy</button>
            {onRemoveVirtualCopy && <button type="button" className={button} aria-expanded={confirmRemove} onClick={() => setConfirmRemove(!confirmRemove)}>Remove virtual copy</button>}
          </div>
          {confirmRemove && onRemoveVirtualCopy && (
            <div className="rounded-md bg-black/25 p-2 text-sm">
              <p>Remove this version and its edits? The original file stays in the shoot.</p>
              <button type="button" className={button} onClick={() => setConfirmRemove(false)}>Cancel</button>
              <button type="button" className={button} onClick={onRemoveVirtualCopy}>Remove copy</button>
            </div>
          )}
          <form className="space-y-1 border-t border-white/10 pt-3" onSubmit={(event) => {
            event.preventDefault();
            const names = new Map<string, string>();
            for (const entry of subjectInput.split(',')) {
              const name = entry.trim().replace(/\s+/g, ' ');
              if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
            }
            const next = [...names.values()];
            onSubjectsChange(next);
            setSubjectInput(next.join(', '));
          }}>
            <label htmlFor="photo-subject-names" className="text-xs font-medium text-zinc-300">Subject names</label>
            <div className="flex gap-1">
              <input id="photo-subject-names" type="text" value={subjectInput} maxLength={240} placeholder="e.g. Coco, Mabel"
                onChange={(event) => setSubjectInput(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/20 px-2 text-base lg:text-sm"
              />
              <button type="submit" className={button} disabled={subjectInput === (frame.subjectNames?.join(', ') ?? '')}>Save</button>
            </div>
          </form>
          <details className="border-t border-white/10">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-zinc-300">Layout</summary>
            <label className="hidden min-h-11 items-center justify-between gap-2 text-sm lg:flex">
              Adjustment panel
              <select value={panelSide} onChange={(event) => onPanelSideChange(event.target.value === 'left' ? 'left' : 'right')}
                className="min-h-10 rounded-md bg-[#252830] px-2">
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={showFilmstrip} onChange={onToggleFilmstrip} /> Pin filmstrip
            </label>
          </details>
          {!frame.isDemo && <button type="button" className={button} disabled={!provider.getOriginal(frame.stableKey)}
            onClick={() => {
              const original = provider.getOriginal(frame.stableKey);
              if (original) downloadExport(original, original instanceof File ? original.name : frame.filename);
            }}>Download original</button>}
          {outputSize && <p className="mt-2 text-xs text-zinc-400">Output {outputSize.width.toLocaleString()} × {outputSize.height.toLocaleString()} px</p>}
        </details>
      </div>
      {exportOpen && <PhotoExportPanel frames={[frame]} provider={provider} source={source} onClose={() => setExportOpen(false)} />}
    </section>
  );
}
