import type { ExportFraming } from '../core/exportFraming';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { EXPORT_PROFILES, type ExportProfile } from '../core/exportProfiles';
import type { PhotoFrame } from '../core/types';
import { archiveExports, downloadExport, loadExportSource, renderExport } from '../providers/browserExport';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

interface Props {
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider;
  source?: HTMLImageElement | null;
  onClose: () => void;
}

const button = 'min-h-11 rounded-md px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-45';
const field = 'min-h-10 w-full rounded-md border border-white/15 bg-[#15171C] px-2 text-base sm:text-sm';

export function PhotoExportPanel({ frames, provider, source, onClose }: Props) {
  const [chosen, setChosen] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('kestrel.lastExport.v1') ?? 'null');
      const ids = Array.isArray(saved) ? saved.filter((id) => EXPORT_PROFILES.some((profile) => profile.id === id)) : [];
      if (ids.length) return ids;
    } catch { /* Use defaults when storage is unavailable. */ }
    return ['master'];
  });
  const [framing, setFraming] = useState<ExportFraming>('fit');
  const [longEdge, setLongEdge] = useState<number>();
  const [profiles, setProfiles] = useState<ExportProfile[]>(() => [...EXPORT_PROFILES]);
  const [timestamp, setTimestamp] = useState<'now' | 'capture' | 'custom'>('now');
  const [custom, setCustom] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const activeExport = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const destinations = profiles.filter(({ id }) => chosen.includes(id));
  const total = destinations.length * frames.length;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelled.current = false;
    title.current?.focus();
    return () => {
      cancelled.current = true;
      activeExport.current?.abort();
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]') ?? [])]
          .filter((item) => !item.matches(':disabled') && item.getClientRects().length > 0);
        const boundary = event.shiftKey ? stops[0] : stops.at(-1);
        if (stops.length && (!dialog.current?.contains(document.activeElement) || document.activeElement === boundary)) {
          event.preventDefault();
          (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [onClose]);

  function changeProfile(id: string, patch: Partial<ExportProfile>) {
    setProfiles((prior) => prior.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
  }

  async function prepare() {
    setProgress(0);
    setError('');
    const controller = new AbortController();
    activeExport.current = controller;
    try { localStorage.setItem('kestrel.lastExport.v1', JSON.stringify(chosen)); } catch { /* Optional preference. */ }
    const started = new Date();
    const customDate = timestamp === 'custom' ? new Date(custom) : null;
    const output: File[] = [];
    try {
      for (const frame of frames) {
        if (cancelled.current) return;
        const image = source && frames.length === 1 ? source : await loadExportSource(frame, provider);
        const recorded = frame.exif.capturedAtMs ?? (provider.getOriginal(frame.stableKey) as File | undefined)?.lastModified;
        const date = customDate ?? (timestamp === 'capture' && Number.isFinite(recorded) ? new Date(recorded!) : started);
        for (const profile of destinations) {
          if (cancelled.current) return;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (cancelled.current) return;
          output.push(await renderExport(image, frame, profile, date, controller.signal, framing, longEdge));
          setProgress(output.length);
        }
      }
      setFiles(output);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not prepare the exports.');
    } finally {
      activeExport.current = null;
      if (!cancelled.current) setProgress(null);
    }
  }

  async function downloadZip() {
    setArchiving(true);
    setError('');
    try {
      const zip = await archiveExports(files);
      if (!cancelled.current) downloadExport(zip, 'kestrel-exports.zip');
    } catch {
      setError('Could not create the ZIP. Try a smaller export selection.');
    } finally {
      setArchiving(false);
    }
  }

  const canShare = files.length > 0 && navigator.canShare?.({ files });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <section ref={dialog} className="workspace-popover flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-white/15 bg-[#191B20] p-4 shadow-xl">
        <header className="flex items-center justify-between gap-2">
          <h2 id="export-title" ref={title} tabIndex={-1} className="text-base font-semibold">Export {frames.length === 1 ? 'photo' : `${frames.length} photos`}</h2>
          <button type="button" onClick={onClose} aria-label="Close export" className={button}><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>
        {files.length ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-zinc-300">{files.length} {files.length === 1 ? 'file ready' : 'files ready'}</p>
            <div className="flex flex-wrap gap-2">
              {files.length === 1 && <button type="button" className={`${button} bg-sky-200 text-zinc-950 hover:bg-sky-100`}
                onClick={() => downloadExport(files[0], files[0].name)}>Download</button>}
              {files.length > 1 && <button type="button" disabled={archiving} className={`${button} bg-sky-200 text-zinc-950 hover:bg-sky-100`}
                onClick={() => void downloadZip()}>{archiving ? 'Packing ZIP…' : 'Download ZIP'}</button>}
              {canShare && <button type="button" className={button} onClick={() => {
                void navigator.share({ files }).catch((reason) => {
                  if ((reason as Error).name !== 'AbortError') setError('Could not share these files. Try downloading them.');
                });
              }}>Share / save to device</button>}
              <button type="button" className={button} onClick={() => setFiles([])}>Change settings</button>
            </div>
            {files.length > 1 && files.length <= 12 && <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">Download individual files</summary>
              {files.map((file, index) => <button type="button" className={`${button} block max-w-full truncate`}
                key={index} onClick={() => downloadExport(file, file.name)}>{file.name}</button>)}
            </details>}
          </div>
        ) : (
          <form className="mt-2 space-y-3" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
            <fieldset disabled={progress !== null} className="grid grid-cols-2 gap-1">
              <legend className="mb-1 text-sm text-zinc-300">Output versions</legend>
              {profiles.map(({ id, label }) => (
                <label key={id} className="flex min-h-11 items-center gap-2 rounded-md bg-white/5 px-2 text-sm">
                  <input type="checkbox" checked={chosen.includes(id)} onChange={(event) =>
                    setChosen((previous) => event.target.checked ? [...previous, id] : previous.filter((item) => item !== id))} />
                  {label}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-zinc-400">Social versions use JPEG. Choose one or more.</p>
            <fieldset disabled={progress !== null} className="space-y-2">
              <label className="block text-sm">Framing
                <select className={`${field} mt-1`} value={framing} onChange={(event) => setFraming(event.target.value as ExportFraming)}>
                  <option value="fit">Fit inside preset</option>
                  <option value="focus">Crop around focus point</option>
                  <option value="border">Fit with white borders</option>
                  <option value="long">Long edge only</option>
                </select>
              </label>
              {framing === 'focus' && <p className="text-xs text-zinc-400">Photos without a focus point crop from the centre. Full-size PNG keeps its framing.</p>}
              {framing === 'border' && <p className="text-xs text-zinc-400">Fits the edited photo inside the preset without cropping. Full-size PNG keeps its framing.</p>}
              {framing === 'long' && <label className="block text-sm">Long edge (px)
                <input className={field} type="number" min={1} max={12000} value={longEdge ?? ''}
                  placeholder="Use each preset’s long edge" onChange={(event) => setLongEdge(event.target.valueAsNumber || undefined)} />
              </label>}
            </fieldset>
            <fieldset disabled={progress !== null} className="space-y-2">
              <label className="block text-sm">Photo date
                <select className={`${field} mt-1`} value={timestamp} onChange={(event) => setTimestamp(event.target.value as typeof timestamp)}>
                  <option value="now">Time of export</option>
                  <option value="capture">Recorded date, when available</option>
                  <option value="custom">Choose date and time…</option>
                </select>
              </label>
              {timestamp === 'custom' && <input required type="datetime-local" aria-label="Custom photo date and time" className={field} value={custom} onChange={(event) => setCustom(event.target.value)} />}
            </fieldset>
            {frames.some((frame) => !frame.isDemo && /\.(nef|nrw)$/i.test(frame.filename)) && (
              <p className="text-xs text-zinc-400">Nikon exports use the embedded JPEG as their source.</p>
            )}
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">Prefixes, size and quality</summary>
              <fieldset disabled={progress !== null} className="space-y-3">
                {destinations.map((profile) => (
                  <div key={profile.id} className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 p-2 sm:grid-cols-4">
                    <h3 className="col-span-full text-sm font-medium">{profile.label}</h3>
                    <label className="text-xs">Filename prefix
                      <input value={profile.prefix} maxLength={24} className={field} onChange={(event) => changeProfile(profile.id, { prefix: event.target.value })} />
                    </label>
                    {profile.format === 'jpeg' && <>
                      {(['width', 'height'] as const).map((axis) => (
                        <label key={axis} className="text-xs capitalize">Max {axis} (px)
                          <input type="number" min={1} max={4096} required className={field} value={profile[axis] || ''}
                            onChange={(event) => changeProfile(profile.id, { [axis]: event.target.valueAsNumber || 0 })} />
                        </label>
                      ))}
                      <label className="text-xs">JPEG quality
                        <input type="number" min={50} max={100} required className={field} value={profile.quality ? Math.round(profile.quality * 100) : ''}
                          onChange={(event) => changeProfile(profile.id, { quality: (event.target.valueAsNumber || 0) / 100 })} />
                      </label>
                    </>}
                  </div>
                ))}
              </fieldset>
            </details>
            <button type="submit" disabled={!total || progress !== null} className={`${button} bg-sky-200 text-zinc-950 hover:bg-sky-100`}>
              {progress !== null ? `Preparing ${progress}/${total}…` : `Prepare ${total} ${total === 1 ? 'file' : 'files'}`}
            </button>
            {progress !== null && <progress aria-label="Export progress" className="block w-full" value={progress} max={total} />}
          </form>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-orange-200">{error}</p>}
      </section>
    </div>
  );
}
