import { PANEL_MIN, PANEL_MAX, clampPanelWidth } from '../core/panelWidth';
import React, { useEffect, useRef, useState } from 'react';
import { messages as m } from '../i18n/messages';
import { ChevronLeft, ChevronRight, ClipboardCopy, Star, X } from 'lucide-react';
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
  dockedSide?: 'left' | 'right';
  onClose: () => void;
  batchCount: number;
  onRate: (id: string, rating: number) => void;
  onFlag: (id: string, decision: CullDecision) => void;
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

export const ExifInspector: React.FC<ExifInspectorProps> = ({ frame, dockedSide = 'right', batchCount, onClose, onRate, onFlag, onSubjects, onKeepTag, loadPicture, mates = [], onTagPhotos, onAutoTag }) => {
  const widthKey = 'kestrel.photoInfoWidth';
  const clampInfoWidth = (value: number) => clampPanelWidth(value, window.innerWidth / 2);
  const [width, setWidth] = useState(() => {
    try { return clampInfoWidth(Number(localStorage.getItem(widthKey) ?? 288)); } catch { return 288; }
  });
  const drag = useRef({ x: 0, width: 0 });
  const changeWidth = (next: number) => {
    const value = clampInfoWidth(next);
    setWidth(value);
    try { localStorage.setItem(widthKey, String(value)); } catch { /* Width still applies in this session. */ }
  };
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'subject'>('info');
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
  if (!frame) return null;

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

  return (
    <aside
      aria-label={m.photoInfo.title}
      style={{ '--photo-info-width': `${width}px` } as React.CSSProperties}
      className={`workspace-popover absolute inset-x-2 top-2 z-40 max-h-[min(calc(100%_-_1rem),calc(100dvh_-_7rem))] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-4 shadow-2xl sm:w-72 lg:relative lg:inset-auto lg:max-h-none lg:w-[var(--photo-info-width)] lg:max-w-[30vw] lg:overflow-hidden lg:p-0 lg:shrink-0 lg:rounded-none lg:border-0 lg:shadow-none ${dockedSide === 'left'
        // Only the docked panel (lg and up) changes side. Below that it floats over the photos, at the right edge where
        // it covers the fewest of them (the first photo is at the top left).
        ? 'sm:right-2 sm:left-auto lg:border-r'
        : 'sm:right-2 sm:left-auto lg:border-l'}`}
    >
      <div role="separator" tabIndex={0} aria-label={m.photoInfo.title} aria-orientation="vertical"
        aria-valuemin={PANEL_MIN} aria-valuemax={Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.floor(window.innerWidth * 0.3)))}
        aria-valuenow={clampInfoWidth(width)}
        className={`absolute inset-y-0 z-10 hidden w-2 touch-none cursor-col-resize bg-white/5 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-300 lg:block ${dockedSide === 'left' ? 'right-0' : 'left-0'}`}
        onPointerDown={event => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, width: clampInfoWidth(width) };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          changeWidth(drag.current.width + (event.clientX - drag.current.x) * (dockedSide === 'left' ? 1 : -1));
        }}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const grow = (event.key === 'ArrowRight') === (dockedSide === 'left');
          changeWidth(clampInfoWidth(width) + (grow ? 20 : -20));
        }} />
      <div className="lg:h-full lg:overflow-y-auto lg:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{m.photoInfo.title}</h2>
        {/* An arrow towards the edge it folds into, as on the editing tools; on small screens, where it floats, a cross. */}
        <button type="button" onClick={onClose} aria-label={m.photoInfo.close} title={m.photoInfo.fold} className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          <X className="h-4 w-4 lg:hidden" aria-hidden="true" />
          {dockedSide === 'left' ? <ChevronLeft className="hidden h-5 w-5 lg:block" aria-hidden="true" /> : <ChevronRight className="hidden h-5 w-5 lg:block" aria-hidden="true" />}
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
      <p className="mt-3 break-words text-sm text-zinc-200">{frame.filename}</p>
      <button type="button" onClick={() => void copyInfo()} title={m.photoInfo.copyHint}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-white/15 px-3 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">
        <ClipboardCopy className="h-4 w-4" aria-hidden="true" />{m.photoInfo.copy}
      </button>
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
      </div>

      </div>
    </aside>
  );
};
