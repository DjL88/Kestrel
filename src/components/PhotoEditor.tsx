import { ChevronDown } from 'lucide-react';
import { DEFAULT_FRAMING, detailAnchor, drawFramedPhoto, type PhotoFraming } from '../core/photoFraming';
import { PhotoViewport } from './PhotoViewport';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_EDIT, EDIT_CHOICES, applyPhotoEdit, isNeutralEdit, type PhotoEdit } from '../core/photoEdits';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

const MAX_EDGE = 3200;

interface Props {
  frame: PhotoFrame;
  provider: BrowserPreviewProvider;
  needsAccess: boolean;
  onEdit: (edit: PhotoEdit) => void;
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
  frame, provider, needsAccess, onEdit, copiedEdit, onCopyEdit, keeperCount,
  onApplyToKeepers, onUndoKeeperEdits, onSubjectsChange, onCreateVirtualCopy, onRemoveVirtualCopy, onFramingChange,
  panelSide, onPanelSideChange, showFilmstrip, onToggleFilmstrip,
}: Props) {
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const editedCanvas = useRef<HTMLCanvasElement>(null);
  const sourceCanvas = useRef<HTMLCanvasElement | null>(null);
  const originalPixels = useRef<ImageData | null>(null);
  const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [compare, setCompare] = useState(false);
  const [manual, setManual] = useState(false);
  const [transform, setTransform] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [exporting, setExporting] = useState(false);
  const [subjectInput, setSubjectInput] = useState(() => frame.subjectNames?.join(', ') ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [editNotice, setEditNotice] = useState('');
  const [exportError, setExportError] = useState(false);
  const edit = frame.edit ?? DEFAULT_EDIT;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const isRaw = /\.(nef|nrw)$/i.test(frame.filename) && !frame.isDemo;

  useEffect(() => {
    let active = true;
    const image = new Image();
    setSourceState('loading');
    originalPixels.current = null;
    sourceCanvas.current = null;

    async function load() {
      const url = await provider.getFullPreviewUrl(frame);
      if (!active) return;
      if (!url) throw new Error('Preview unavailable');
      image.src = url;
      await image.decode();
      if (!active) return;

      const canvas = document.createElement('canvas');
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      sourceCanvas.current = canvas;
      setSourceState('ready');
    }

    void load().catch(() => {
      if (active) setSourceState('error');
    });
    return () => { active = false; };
    // Catalogue edits replace the frame object while keeping the source for this ID.
  }, [frame.id, provider, needsAccess]);

  useEffect(() => {
    const source = sourceCanvas.current;
    const original = originalCanvas.current;
    if (!source || !original || sourceState !== 'ready') return;
    drawFramedPhoto(source, original, framing);
    originalPixels.current = original.getContext('2d')!.getImageData(0, 0, original.width, original.height);
  }, [framing, sourceState]);

  function createCropCopy() {
    const source = sourceCanvas.current;
    if (!source) return;
    const small = document.createElement('canvas');
    small.width = 64;
    small.height = 64;
    const context = small.getContext('2d');
    if (!context) return;
    context.translate(32, 32);
    context.rotate(framing.turns * Math.PI / 2);
    context.drawImage(source, -32, -32, 64, 64);
    const anchor = detailAnchor(context.getImageData(0, 0, 64, 64).data, 64, 64);
    const portrait = (framing.turns % 2 ? source.width : source.height) > (framing.turns % 2 ? source.height : source.width);
    onCreateVirtualCopy({ ...framing, ...anchor, ratio: portrait ? 4 / 5 : 5 / 4 });
  }

  useEffect(() => {
    const pixels = originalPixels.current;
    const canvas = editedCanvas.current;
    if (sourceState !== 'ready' || !pixels || !canvas) return;
    if (canvas.width !== pixels.width) canvas.width = pixels.width;
    if (canvas.height !== pixels.height) canvas.height = pixels.height;
    const context = canvas.getContext('2d')!;
    const output = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    applyPhotoEdit(output.data, edit);
    context.putImageData(output, 0, 0);
  }, [edit, framing, sourceState]);

  function download() {
    const canvas = editedCanvas.current;
    if (!canvas || sourceState !== 'ready') return;
    setExporting(true);
    setExportError(false);
    canvas.toBlob((blob) => {
      setExporting(false);
      if (!blob) {
        setExportError(true);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${frame.filename.replace(/\.[^.]+$/, '')}-${isRaw ? 'preview-' : ''}kestrel.jpg`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 'image/jpeg', 0.95);
  }

  const button = 'min-h-11 rounded-md px-3 text-sm text-zinc-200 hover:bg-white/8 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-400';
  return (
    <section aria-label="Photo editor" className="flex min-h-0 flex-1 flex-col bg-[#0B0C0E] lg:flex-row">
      <div className="relative flex min-h-0 flex-1 bg-black">
        <PhotoViewport zoom={transform.zoom} pan={transform.pan}
          onTransform={(zoom, pan) => setTransform({ zoom, pan })}
          overlayMode={compare && sourceState === 'ready' ? 'wipe' : 'hidden'}
          labels={['Original', 'Edited']}
          base={<canvas ref={editedCanvas} aria-label="Edited photo" role="img"
            hidden={sourceState !== 'ready'} className="absolute inset-0 h-full w-full object-contain" />}
          overlay={<canvas ref={originalCanvas} aria-label="Original photo" role="img"
            className="absolute inset-0 h-full w-full object-contain" />}
        />
        {sourceState !== 'ready' && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-300">
            {sourceState === 'loading' ? 'Opening photo…' : needsAccess ? 'Reconnect the original file to edit it.' : 'This photo has no browser-readable preview.'}
          </p>
        )}
      </div>
      <div className={`max-h-[44%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 bg-[#14161A] p-3 lg:max-h-none lg:w-72 lg:border-t-0 lg:p-4 ${panelSide === 'left' ? 'lg:order-first lg:border-r' : 'lg:border-l'}`}>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={button} aria-pressed={compare} disabled={sourceState !== 'ready'} onClick={() => setCompare(!compare)}>
            Before / after
          </button>
          <button type="button" className={`${button} bg-sky-200 font-semibold !text-zinc-950 hover:bg-sky-100`} disabled={sourceState !== 'ready' || exporting} onClick={download}>
            {exporting ? 'Exporting…' : isRaw ? 'Export preview JPEG' : 'Export JPEG'}
          </button>
        </div>
        {isRaw && <p className="text-xs text-zinc-300">Editing embedded JPEG preview</p>}
        <button type="button" aria-expanded={manual} className={button} onClick={() => setManual(!manual)}>{manual ? 'Hide sliders' : 'Manual sliders'}</button>
        {exportError && <p role="alert" className="text-sm text-orange-200">Couldn’t create the JPEG. Try exporting again.</p>}
        {EDIT_CHOICES.map(({ key, label, options }) => (
          <fieldset key={key} disabled={sourceState !== 'ready'} className="min-w-0 rounded-md bg-white/4 disabled:opacity-50">
            <legend className="ml-2 px-1 text-xs font-medium text-zinc-300">{label}</legend>
            <div className="grid grid-cols-3 gap-1">
              {options.map((name, index) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={edit[key] === index - 1}
                  onClick={() => {
                    onEdit({ ...edit, [key]: index - 1 });
  
                  }}
                  className={`${button} px-1 text-xs aria-pressed:bg-sky-300/15 aria-pressed:text-sky-200`}
                >{name}</button>
              ))}
            </div>
            {manual && (
              <label className="flex min-h-10 items-center gap-2 px-2 pb-1">
                <span className="sr-only">{label} adjustment</span>
                <input type="range" min={-2} max={2} step={0.1} value={edit[key]}
                  onChange={(event) => onEdit({ ...edit, [key]: event.target.valueAsNumber })}
                  className="min-w-0 flex-1 accent-sky-300" />
                <output className="min-w-10 text-right text-xs tabular-nums text-zinc-300">
                  {key === 'exposure' ? `${(edit[key] * 0.4).toFixed(2)} EV` :
                    `${Math.round(edit[key] * (key === 'warmth' ? 8 : 20))}%`}
                </output>
              </label>
            )}
          </fieldset>
        ))}
        <details className="border-t border-white/10">
          <summary className="min-h-11 cursor-pointer py-3 text-sm">Crop &amp; straighten</summary>
          <fieldset disabled={sourceState !== 'ready'} className="space-y-2">
            <div className="flex flex-wrap">
              <button type="button" className={button} onClick={createCropCopy}>Make crop copy</button>
              <button type="button" className={button} onClick={() => onFramingChange({
                ...framing, turns: (framing.turns + 1) % 4, x: 1 - framing.y, y: framing.x,
              })}>Rotate 90°</button>
              <button type="button" className={button} onClick={() => onFramingChange(DEFAULT_FRAMING)}>Reset crop</button>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-2 text-sm">
              Aspect ratio
              <select value={framing.ratio ?? ''} onChange={(event) => onFramingChange({ ...framing, ratio: Number(event.target.value) || null })}
                className="min-h-10 rounded-md bg-[#252830] px-2">
                <option value="">Original</option>
                <option value={1}>Square</option>
                <option value={4 / 5}>4:5</option>
                <option value={5 / 4}>5:4</option>
                <option value={3 / 2}>3:2</option>
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
          <p className="mt-2 text-xs text-zinc-400">{frame.filename}{frame.isDemo ? ' · Demo' : ''} · JPEG up to {MAX_EDGE.toLocaleString()} px</p>
        </details>
      </div>
    </section>
  );
}
