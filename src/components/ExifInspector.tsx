import React from 'react';
import { Star, X } from 'lucide-react';
import { SubjectPanel } from './SubjectPanel';
import { addTags, type SubjectKind } from '../core/subjectTags';
import { formatAperture, formatFocalLength } from '../core/exifParser';
import type { CullDecision, PhotoFrame } from '../core/types';

interface ExifInspectorProps {
  frame: PhotoFrame | null;
  onClose: () => void;
  batchCount: number;
  onRate: (id: string, rating: number) => void;
  onFlag: (id: string, decision: CullDecision) => void;
  /** Change what the photo is of. Species named by the app can be corrected here. */
  onSubjects: (frame: PhotoFrame, tags: string[], kind: SubjectKind | undefined) => void;
  onKeepTag: (frame: PhotoFrame, name: string) => void;
}

function formatCaptureTime(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export const ExifInspector: React.FC<ExifInspectorProps> = ({ frame, batchCount, onClose, onRate, onFlag, onSubjects, onKeepTag }) => {
  if (!frame) return null;

  const { exif } = frame;
  const rating = frame.rating ?? exif.rating ?? 0;
  const rows: { label: string; value: string }[] = [
    { label: 'Camera', value: exif.camera ?? '' },
    { label: 'Lens', value: exif.lens ?? '' },
    { label: 'Focal Length', value: formatFocalLength(exif.focalLengthMm) },
    { label: 'Aperture', value: formatAperture(exif.apertureF) },
    { label: 'Shutter', value: exif.shutterSpeed ?? '' },
    { label: 'ISO', value: typeof exif.iso === 'number' ? String(exif.iso) : '' },
    { label: 'Captured', value: formatCaptureTime(exif.capturedAtMs) },
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
      className="workspace-popover absolute inset-x-2 top-2 z-10 max-h-[min(calc(100%_-_1rem),calc(100dvh_-_7rem))] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-4 shadow-2xl sm:right-2 sm:left-auto sm:w-72 lg:static lg:max-h-none lg:shrink-0 lg:rounded-none lg:border-0 lg:border-l lg:shadow-none"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Photo info</h2>
        <button type="button" onClick={onClose} aria-label="Close photo info" title="Close photo info" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="break-words text-sm text-zinc-200">{frame.filename}</p>
      {exif.formatLabel && <p className="mt-1 text-xs text-zinc-400">{exif.formatLabel}</p>}
      {frame.burstGroupId && <p className="mt-1 text-xs text-zinc-400">Burst frame {frame.burstIndex} of {frame.burstCount}</p>}
      <div className="mt-3 border-t border-white/10 pt-3">
        <SubjectPanel kind={frame.subjectKind} tags={addTags(frame.subjectNames ?? [], frame.tags ?? [])} autoTags={frame.autoTags}
          onChange={(tags, kind) => onSubjects(frame, tags, kind)} onKeep={(name) => onKeepTag(frame, name)} />
      </div>
      {exif.isEmbeddedPreviewOnly && <p className="mt-1 text-xs text-zinc-300">Embedded RAW preview (not full RAW decoding)</p>}
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
      <dl className="mt-4 space-y-2 text-xs">
        {rows.filter(({ value }) => value).map(({ label, value }) => (
          <div key={label} className="grid grid-cols-[auto_1fr] items-baseline gap-2">
            <dt className="text-zinc-400">{label}</dt>
            <dd className="min-w-0 break-words text-right text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
};
