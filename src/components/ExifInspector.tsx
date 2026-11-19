import React, { useEffect, useState } from 'react';
import { ClipboardCopy, Star, X } from 'lucide-react';
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
      setCopyStatus('Photo details copied.');
    } catch {
      setCopyStatus('Could not copy. Allow clipboard access or try again.');
    }
  }
  const rating = frame.rating ?? exif.rating ?? 0;
  const rows: { label: string; value: string }[] = [
    { label: 'Camera', value: exif.camera ?? '' },
    { label: 'Lens', value: exif.lens ?? '' },
    { label: 'Focal Length', value: formatFocalLength(exif.focalLengthMm) },
    { label: 'Aperture', value: formatAperture(exif.apertureF) },
    { label: 'Shutter', value: exif.shutterSpeed ?? '' },
    { label: 'ISO', value: typeof exif.iso === 'number' ? String(exif.iso) : '' },
    { label: 'Captured', value: formatCaptureDateTime(exif.capturedAtMs) },
    {
      label: 'Dimensions',
      value:
        typeof exif.width === 'number' && typeof exif.height === 'number'
          ? `${exif.width} × ${exif.height}`
          : '',
    },
  ];

  return (
    <aside
      aria-label="Photo info"
      className={`workspace-popover absolute inset-x-2 top-2 z-10 max-h-[min(calc(100%_-_1rem),calc(100dvh_-_7rem))] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-4 shadow-2xl sm:w-72 lg:static lg:max-h-none lg:shrink-0 lg:rounded-none lg:border-0 lg:shadow-none ${dockedSide === 'left'
        // Only the docked panel (lg and up) changes side. Below that it floats over the photos, at the right edge where
        // it covers the fewest of them (the first photo is at the top left).
        ? 'sm:right-2 sm:left-auto lg:border-r'
        : 'sm:right-2 sm:left-auto lg:border-l'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Photo info</h2>
        <button type="button" onClick={onClose} aria-label="Close photo info" title="Close photo info" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div role="tablist" aria-label="Photo details" className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1">
        {(['info', 'subject'] as const).map((tab) => (
          <button key={tab} type="button" role="tab" id={`photo-tab-${tab}`}
            aria-selected={activeTab === tab} aria-controls={`photo-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`min-h-11 rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:outline-sky-300 ${activeTab === tab ? 'bg-white/15 text-white' : 'text-zinc-400 hover:bg-white/5'}`}>
            {tab === 'info' ? 'Info' : 'Subject'}
          </button>
        ))}
      </div>
      <div id="photo-panel-info" role="tabpanel" aria-labelledby="photo-tab-info" hidden={activeTab !== 'info'}>
      <p className="mt-3 break-words text-sm text-zinc-200">{frame.filename}</p>
      <button type="button" onClick={() => void copyInfo()} title="Copy camera details, rating and decision; excludes location and file paths"
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-white/15 px-3 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">
        <ClipboardCopy className="h-4 w-4" aria-hidden="true" />Copy photo details
      </button>
      {copyStatus && <p role="status" className="mt-1 text-xs text-zinc-300">{copyStatus}</p>}
      {exif.formatLabel && <p className="mt-1 text-xs text-zinc-400">{exif.formatLabel}</p>}
      {frame.burstGroupId && <p className="mt-1 text-xs text-zinc-400">Burst frame {frame.burstIndex} of {frame.burstCount}</p>}
      {exif.isEmbeddedPreviewOnly && <p className="mt-1 text-xs text-zinc-300">Embedded RAW preview (not full RAW decoding)</p>}
      <section aria-label="Camera and capture details" className="mt-3 border-t border-white/10 pt-3">
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">Camera & capture</h3>
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
            Species matches are suggestions, not proof of an animal. Choose Wildlife above to allow automatic species tags; aircraft and other subjects will not be given bird names automatically.
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
      {batchCount > 1 && <p className="mt-3 text-xs text-sky-200">Apply ratings and flags to {batchCount} selected photos</p>}
      <div className="mt-3 border-y border-white/10 py-2">
        <div role="group" aria-label={`Star rating, ${rating} of 5`} className="flex flex-wrap">
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} type="button" aria-label={`Rate ${star} of 5 stars`} title={`Rate ${star} of 5 stars`} aria-pressed={rating === star}
              onClick={() => onRate(frame.id, star)} className="grid h-11 w-10 place-items-center rounded-md hover:bg-white/8">
              <Star className={`h-5 w-5 ${rating >= star ? 'fill-current text-sky-200' : 'text-zinc-400'}`} aria-hidden="true" />
            </button>
          ))}
          {(rating > 0 || batchCount > 1) && <button type="button" onClick={() => onRate(frame.id, 0)} className="min-h-11 px-2 text-xs text-zinc-300">Clear stars</button>}
        </div>
        <div role="group" aria-label="Photo flag" className="flex flex-wrap gap-1">
          {(['unreviewed', 'keep', 'reject'] as const).map((flag) => (
            <button key={flag} type="button" aria-pressed={frame.decision === flag} onClick={() => onFlag(frame.id, flag)}
              className="min-h-11 rounded-md px-2 text-xs capitalize text-zinc-300 hover:bg-white/8 aria-pressed:bg-white/15 aria-pressed:text-white">
              {flag === 'unreviewed' ? 'Unflagged' : flag}
            </button>
          ))}
        </div>
      </div>
      </div>

    </aside>
  );
};
