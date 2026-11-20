import React, { useEffect, useRef, useState } from 'react';
import { messages as m } from '../i18n/messages';
import { libraryText as libraryT } from '../i18n/areas/library';
import { ChevronLeft, ChevronRight, ClipboardCopy, Download, PanelTopOpen, Star, X } from 'lucide-react';
import { exportText } from '../i18n/areas/export';
import { downloadInBrowser } from '../providers/browserExport';
import { isDesktopApp, isMobileShell, saveWithDialog } from '../providers/desktopShell';
import { photoSidecar, readPhotoSidecar, type ImportedPhotoSidecar } from '../core/photoSidecar';
import { FloatingPane } from './FloatingPane';
import { PHOTO_INFO_DOCK_QUERY } from '../core/photoInfoLayout';
import { formatCaptureDateTime, photoInfoText } from '../core/photoInfoText';
import { SubjectPanel } from './SubjectPanel';
import { SpeciesSuggestions } from './SpeciesSuggestions';
import { mayAutoTag } from '../core/autoTags';
import { hasName } from '../core/speciesBurst';
import { addTags, type SubjectKind } from '../core/subjectTags';
import { formatAperture, formatFocalLength } from '../core/exifParser';
import type { CullDecision, PhotoFrame } from '../core/types';

interface ExifInspectorProps {
  frame: PhotoFrame | null;
  /** The dock sits opposite the photographer's preferred tool hand. */
  photoOnly?: boolean;
  dockedSide?: 'left' | 'right';
  onClose: () => void;
  batchCount: number;
  onRate: (id: string, rating: number) => void;
  onFlag: (id: string, decision: CullDecision) => void;
  onImportSidecar: (id: string, metadata: ImportedPhotoSidecar) => void;
  /** Change what the photo is of. Species named by the app can be corrected here. */
  onSubjects: (frame: PhotoFrame, tags: string[], kind: SubjectKind | undefined) => void;
  onKeepTag: (frame: PhotoFrame, name: string) => void;
  /** A small picture of a photo for the on-device species model to look at. Null when its original is not available. */
  loadPicture?: (frame: PhotoFrame) => Promise<HTMLCanvasElement | null>;
  /** The other photos in this one's burst, and a way to tag some of them after the person agrees. */
  mates?: PhotoFrame[];
  onTagPhotos?: (ids: string[], name: string, kind: SubjectKind | undefined) => void;
  /** The app tags a photo by itself when the model is sure. */
  onAutoTag?: (frame: PhotoFrame, name: string, kind: SubjectKind | undefined) => void;
}

export const ExifInspector: React.FC<ExifInspectorProps> = ({ frame, dockedSide = 'right', photoOnly = false, batchCount, onClose, onRate, onFlag, onImportSidecar, onSubjects, onKeepTag, loadPicture, mates = [], onTagPhotos, onAutoTag }) => {
  const sidecarInput = useRef<HTMLInputElement>(null);
  const [sidecarBusy, setSidecarBusy] = useState(false);
  const [sidecarStatus, setSidecarStatus] = useState<{ id: string; message: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'subject'>('info');
  const [detached, setDetached] = useState(() => {
    try { return window.localStorage.getItem('kestrel-info-undocked-v1') === 'true'; } catch { return false; }
  });
  const [wideScreen, setWideScreen] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHOTO_INFO_DOCK_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(PHOTO_INFO_DOCK_QUERY);
    const update = () => setWideScreen(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const detach = (value: boolean) => {
    setDetached(value);
    try { window.localStorage.setItem('kestrel-info-undocked-v1', String(value)); } catch { /* no persistence required */ }
  };
  const floating = detached && wideScreen;
  const [picture, setPicture] = useState<HTMLCanvasElement | null>(null);
  const frameId = frame?.id;
  // The species model looks at a small copy of the photo, made when its details are opened.
  useEffect(() => {
    let active = true;
    setPicture(null);
    if (frame && loadPicture) void loadPicture(frame).then((canvas) => { if (active) setPicture(canvas); }, () => { /* no picture: suggestions simply wait */ });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId, loadPicture]);
  if (!frame || (photoOnly && !floating)) return null;

  const { exif } = frame;
  const selectedFrame = frame;
  async function copyInfo() {
    try {
      await navigator.clipboard.writeText(photoInfoText(selectedFrame));
      setCopyStatus(m.photoInfo.copied);
    } catch {
      setCopyStatus(m.photoInfo.copyFailed);
    }
  }
  async function saveSidecar() {
    if (sidecarBusy) return;
    setSidecarBusy(true);
    setSidecarStatus(null);
    try {
      const { bytes, filename } = photoSidecar(selectedFrame);
      const file = new Blob([bytes], { type: 'application/rdf+xml' });
      if (isDesktopApp() && !isMobileShell()) {
        if (!await saveWithDialog(file, filename, true)) return;
      } else if (isMobileShell()) {
        const share = { files: [new File([file], filename, { type: file.type })] };
        if (navigator.canShare?.(share)) await navigator.share(share);
        else downloadInBrowser(file, filename);
      } else {
        downloadInBrowser(file, filename);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSidecarStatus({ id: selectedFrame.id, message: exportText.sidecar.saveFailed });
    } finally {
      setSidecarBusy(false);
    }
  }
  async function importSidecar(file: File) {
    setSidecarBusy(true);
    setSidecarStatus(null);
    try {
      const metadata = await readPhotoSidecar(file, selectedFrame);
      onImportSidecar(selectedFrame.id, metadata);
      setSidecarStatus({ id: selectedFrame.id, message: exportText.sidecar.loaded });
    } catch {
      setSidecarStatus({ id: selectedFrame.id, message: exportText.sidecar.loadFailed });
    } finally {
      setSidecarBusy(false);
    }
  }
  const rating = frame.rating ?? exif.rating ?? 0;
  const rows: { label: string; value: string }[] = [
    { label: m.photoInfo.camera, value: exif.camera ?? '' },
    { label: m.photoInfo.lens, value: exif.lens ?? '' },
    { label: m.photoInfo.focalLength, value: formatFocalLength(exif.focalLengthMm) },
    { label: m.photoInfo.aperture, value: formatAperture(exif.apertureF) },
    { label: m.photoInfo.shutter, value: exif.shutterSpeed ?? '' },
    { label: 'ISO', value: typeof exif.iso === 'number' ? String(exif.iso) : '' },
    { label: m.photoInfo.captured, value: formatCaptureDateTime(exif.capturedAtMs) },
    {
      label: m.photoInfo.dimensions,
      value:
        typeof exif.width === 'number' && typeof exif.height === 'number'
          ? `${exif.width} × ${exif.height}`
          : '',
    },
  ];

  const inspector = (
    <aside
      aria-label={m.photoInfo.title}
      className={`${floating ? 'h-full w-full min-w-0 overflow-y-auto bg-kestrel-panel p-4' : 'workspace-popover absolute inset-x-2 bottom-2 top-auto z-40 max-h-[min(65dvh,calc(100dvh_-_10rem))] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-4 shadow-2xl sm:w-72 info-dock:static info-dock:max-h-none info-dock:shrink-0 info-dock:rounded-none info-dock:border-0 info-dock:shadow-none'} ${dockedSide === 'left'
        // Only the docked panel (lg and up) changes side. Below that it floats over the photos, at the right edge where
        // it covers the fewest of them (the first photo is at the top left).
        ? 'sm:right-2 sm:left-auto info-dock:border-r'
        : 'sm:right-2 sm:left-auto info-dock:border-l'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{m.photoInfo.title}</h2>
        {!floating && <button data-info-undock type="button" onClick={() => detach(true)} title={libraryT.floatingPane.undockInfoHelp}
          aria-label={libraryT.floatingPane.undockInfo} className="hidden h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300 info-dock:grid">
          <PanelTopOpen className="h-4 w-4" aria-hidden="true"/>
        </button>}
        {/* An arrow towards the edge it folds into, as on the editing tools; on small screens, where it floats, a cross. */}
        <button type="button" onClick={onClose} aria-label={m.photoInfo.close} title={m.photoInfo.fold} className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          <X className="h-4 w-4 info-dock:hidden" aria-hidden="true" />
          {dockedSide === 'left' ? <ChevronLeft className="hidden h-5 w-5 info-dock:block" aria-hidden="true" /> : <ChevronRight className="hidden h-5 w-5 info-dock:block" aria-hidden="true" />}
        </button>
      </div>
      <div role="tablist" aria-label={m.photoInfo.details} className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1">
        {(['info', 'subject'] as const).map((tab) => (
          <button key={tab} type="button" role="tab" id={`photo-tab-${tab}`}
            aria-selected={activeTab === tab} aria-controls={`photo-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`min-h-11 rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:outline-sky-300 ${activeTab === tab ? 'bg-white/15 text-white' : 'text-zinc-400 hover:bg-white/5'}`}>
            {tab === 'info' ? m.photoInfo.tabInfo : m.photoInfo.tabSubject}
          </button>
        ))}
      </div>
      <div id="photo-panel-info" role="tabpanel" aria-labelledby="photo-tab-info" hidden={activeTab !== 'info'}>
      <div className="mt-3 flex min-w-0 items-center gap-1">
        <p className="min-w-0 flex-1 break-words text-sm text-zinc-200">{frame.filename}</p>
        <button type="button" onClick={() => void copyInfo()} title={m.photoInfo.copyHint} aria-label={m.photoInfo.copy}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-zinc-300 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {copyStatus && <p role="status" className="mt-1 text-xs text-zinc-300">{copyStatus}</p>}
      {exif.formatLabel && <p className="mt-1 text-xs text-zinc-400">{exif.formatLabel}</p>}
      {frame.burstGroupId && <p className="mt-1 text-xs text-zinc-400">{m.photoInfo.burst(String(frame.burstIndex ?? 0), String(frame.burstCount ?? 0))}</p>}
      {exif.isEmbeddedPreviewOnly && <p className="mt-1 text-xs text-zinc-300">{m.photoInfo.embeddedPreview}</p>}
      <section aria-label={m.photoInfo.cameraCapture} className="mt-3 border-t border-white/10 pt-3">
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">{m.photoInfo.cameraCapture}</h3>
        <dl className="space-y-2 text-xs">
          {rows.filter(({ value }) => value).map(({ label, value }) => (
            <div key={label} className="grid grid-cols-[auto_1fr] items-baseline gap-2">
              <dt className="text-zinc-400">{label}</dt>
              <dd className="min-w-0 break-words text-right text-zinc-200">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      </div>
      <div id="photo-panel-subject" role="tabpanel" aria-labelledby="photo-tab-subject" hidden={activeTab !== 'subject'} className="pt-3">
        <SubjectPanel kind={frame.subjectKind} tags={addTags(frame.subjectNames ?? [], frame.tags ?? [])} autoTags={frame.autoTags}
          onChange={(tags, kind) => onSubjects(frame, tags, kind)} onKeep={(name) => onKeepTag(frame, name)} />
        {frame.subjectKind !== 'wildlife' && (
          <p className="mt-2 text-xs text-zinc-400">
            {m.photoInfo.speciesNotice}
          </p>
        )}
        {loadPicture && (
          <SpeciesSuggestions frameId={frame.id} ready={Boolean(picture)} getPicture={() => picture}
            tags={addTags(frame.subjectNames ?? [], frame.tags ?? [])} kind={frame.subjectKind}
            onAccept={(name, kind) => onSubjects(frame, addTags(addTags(frame.subjectNames ?? [], frame.tags ?? []), [name]), frame.subjectKind ?? kind)}
            mates={mates.map((mate) => ({ id: mate.id, has: (name: string) => hasName(mate, name), load: async () => loadPicture(mate) }))}
            canAutoTag={frame.subjectKind === 'wildlife' && mayAutoTag(frame, '')} declined={frame.declinedTags ?? []} onAutoTag={(name, kind) => onAutoTag?.(frame, name, kind)}
            onTagMates={onTagPhotos} />
        )}
      </div>
      <div hidden={activeTab !== 'info'}>
      {batchCount > 1 && <p className="mt-3 text-xs text-sky-200">{m.photoInfo.batch(String(batchCount))}</p>}
      <div className="mt-3 border-y border-white/10 py-2">
        <div role="group" aria-label={m.photoInfo.starRating(String(rating))} className="flex flex-wrap">
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} type="button" aria-label={m.photoInfo.rateStars(String(star))} title={m.photoInfo.rateStars(String(star))} aria-pressed={rating === star}
              onClick={() => onRate(frame.id, star)} className="grid h-11 w-10 place-items-center rounded-md hover:bg-white/8">
              <Star className={`h-5 w-5 ${rating >= star ? 'fill-current text-sky-200' : 'text-zinc-400'}`} aria-hidden="true" />
            </button>
          ))}
          {(rating > 0 || batchCount > 1) && <button type="button" onClick={() => onRate(frame.id, 0)} className="min-h-11 px-2 text-xs text-zinc-300">{m.photoInfo.clearStars}</button>}
        </div>
        <div role="group" aria-label={m.photoInfo.flag} className="flex flex-wrap gap-1">
          {(['unreviewed', 'keep', 'reject'] as const).map((flag) => (
            <button key={flag} type="button" aria-pressed={frame.decision === flag} onClick={() => onFlag(frame.id, flag)}
              className="min-h-11 rounded-md px-2 text-xs capitalize text-zinc-300 hover:bg-white/8 aria-pressed:bg-white/15 aria-pressed:font-semibold aria-pressed:text-white">
              {/* The chosen flag shows a tick and bold words, not only a lighter background. */}
              {frame.decision === flag && <span aria-hidden="true">✓ </span>}{flag === 'unreviewed' ? m.photoInfo.undecided : flag === 'keep' ? m.keep : m.photoInfo.reject}
            </button>
          ))}
        </div>
      </div>
      {!frame.isDemo && (
        <section className="mt-3 border-t border-white/10 pt-3" aria-label={exportText.sidecar.save}>
          <input ref={sidecarInput} type="file" accept=".xmp,application/rdf+xml" hidden onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importSidecar(file);
          }} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void saveSidecar()} disabled={sidecarBusy}
                className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border border-white/15 px-2 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-50">
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />{exportText.sidecar.save}
              </button>
            <button type="button" onClick={() => sidecarInput.current?.click()} disabled={sidecarBusy}
              className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border border-white/15 px-2 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-50">
              {exportText.sidecar.load}
            </button>
          </div>
          {sidecarStatus?.id === frame.id && <p role="status" className="mt-2 text-xs text-zinc-300">{sidecarStatus.message}</p>}
        </section>
      )}
      </div>

    </aside>
  );
  return floating
    ? <FloatingPane title={m.photoInfo.title} photoOnly={photoOnly} initialSide={dockedSide} storageKey="kestrel-info-float-rect-v1" dockFocusSelector="[data-info-undock]" onDock={() => detach(false)}>{inspector}</FloatingPane>
    : inspector;
};
