import React from 'react';
import { X } from 'lucide-react';
import { formatAperture, formatFocalLength } from '../core/exifParser';
import type { PhotoFrame } from '../core/types';

interface ExifInspectorProps {
  frame: PhotoFrame | null;
  onClose: () => void;
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

export const ExifInspector: React.FC<ExifInspectorProps> = ({ frame, onClose }) => {
  if (!frame) return null;

  const { exif } = frame;
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
      className="absolute inset-x-2 top-2 z-10 max-h-[calc(100%_-_1rem)] overflow-y-auto rounded-xl border border-white/12 bg-[#191B20] p-4 shadow-2xl sm:right-2 sm:left-auto sm:w-72 lg:static lg:max-h-none lg:shrink-0 lg:rounded-none lg:border-0 lg:border-l lg:shadow-none"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Photo info</h2>
        <button type="button" onClick={onClose} aria-label="Close photo info" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="break-words text-sm text-zinc-200">{frame.filename}</p>
      {exif.formatLabel && <p className="mt-1 text-xs text-zinc-400">{exif.formatLabel}</p>}
      {frame.burstGroupId && <p className="mt-1 text-xs text-zinc-400">Burst frame {frame.burstIndex} of {frame.burstCount}</p>}
      {Boolean(frame.subjectNames?.length) && <p className="mt-1 text-xs text-zinc-300">{frame.subjectNames?.join(', ')}</p>}
      {exif.isEmbeddedPreviewOnly && <p className="mt-1 text-xs text-zinc-300">Embedded NEF preview</p>}
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
