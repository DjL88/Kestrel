import { ChevronDown } from 'lucide-react';
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
  onApplyToKeepers: (edit: PhotoEdit) => void;
  onUndoKeeperEdits?: () => void;
  onSubjectsChange: (names: string[]) => void;
}

export function PhotoEditor({
  frame, provider, needsAccess, onEdit, copiedEdit, onCopyEdit, keeperCount,
  onApplyToKeepers, onUndoKeeperEdits, onSubjectsChange,
}: Props) {
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const editedCanvas = useRef<HTMLCanvasElement>(null);
  const originalPixels = useRef<ImageData | null>(null);
  const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showOriginal, setShowOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [subjectInput, setSubjectInput] = useState(() => frame.subjectNames?.join(', ') ?? '');
  const [confirmApply, setConfirmApply] = useState(false);
  const [editNotice, setEditNotice] = useState('');
  const [exportError, setExportError] = useState(false);
  const edit = frame.edit ?? DEFAULT_EDIT;
  const isRaw = /\.(nef|nrw)$/i.test(frame.filename) && !frame.isDemo;

  useEffect(() => {
    let active = true;
    const image = new Image();
    setSourceState('loading');
    originalPixels.current = null;

    async function load() {
      const url = await provider.getFullPreviewUrl(frame);
      if (!active) return;
      if (!url) throw new Error('Preview unavailable');
      image.src = url;
      await image.decode();
      if (!active) return;

      const canvas = originalCanvas.current!;
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      originalPixels.current = context.getImageData(0, 0, canvas.width, canvas.height);
      setSourceState('ready');
    }

    void load().catch(() => {
      if (active) setSourceState('error');
    });
    return () => { active = false; };
    // Catalogue edits replace the frame object while keeping the source for this ID.
  }, [frame.id, provider, needsAccess]);

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
  }, [edit, sourceState]);

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
      <div className="relative min-h-0 flex-1 bg-black">
        <canvas
          ref={originalCanvas}
          aria-label="Original photo"
          role="img"
          hidden={sourceState !== 'ready' || !showOriginal}
          className="absolute inset-0 h-full w-full object-contain"
        />
        <canvas
          ref={editedCanvas}
          aria-label="Edited photo"
          role="img"
          hidden={sourceState !== 'ready' || showOriginal}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {sourceState !== 'ready' && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-300">
            {sourceState === 'loading' ? 'Opening photo…' : needsAccess ? 'Reconnect the original file to edit it.' : 'This photo has no browser-readable preview.'}
          </p>
        )}
      </div>
      <div className="max-h-[44%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 bg-[#14161A] p-3 lg:max-h-none lg:w-72 lg:border-t-0 lg:border-l lg:p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={button} aria-pressed={showOriginal} disabled={sourceState !== 'ready'} onClick={() => setShowOriginal(!showOriginal)}>
            {showOriginal ? 'Show edited' : 'Show original'}
          </button>
          <button type="button" className={`${button} bg-sky-200 font-semibold !text-zinc-950 hover:bg-sky-100`} disabled={sourceState !== 'ready' || exporting} onClick={download}>
            {exporting ? 'Exporting…' : isRaw ? 'Export preview JPEG' : 'Export JPEG'}
          </button>
        </div>
        {isRaw && <p className="text-xs text-zinc-300">Editing embedded JPEG preview</p>}
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
                    setShowOriginal(false);
                  }}
                  className={`${button} px-1 text-xs aria-pressed:bg-sky-300/15 aria-pressed:text-sky-200`}
                >{name}</button>
              ))}
            </div>
          </fieldset>
        ))}
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
              setShowOriginal(false);
              setEditNotice('Adjustments pasted');
            }}>Paste adjustments</button>
            <button type="button" disabled={isNeutralEdit(edit)} className={button} onClick={() => {
              onEdit(DEFAULT_EDIT);
              setShowOriginal(false);
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
                setShowOriginal(false);
                setEditNotice(`Updated ${keeperCount} keepers`);
              }}>Apply adjustments</button>
            </div>
          )}
          <p role="status" className="text-xs text-zinc-400">{editNotice}</p>
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
          <p className="mt-2 text-xs text-zinc-400">{frame.filename}{frame.isDemo ? ' · Demo' : ''} · JPEG up to {MAX_EDGE.toLocaleString()} px</p>
        </details>
      </div>
    </section>
  );
}
