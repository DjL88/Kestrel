import React from 'react';
import { Check, CircleDashed, HardDrive, X } from 'lucide-react';
import { formatAperture, formatFocalLength } from '../core/exifParser';
import type { CullDecision, PhotoFrame } from '../core/types';

interface ExifInspectorProps {
  frame: PhotoFrame | null;
  onDecision: (frameId: string, decision: CullDecision) => void;
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

export const ExifInspector: React.FC<ExifInspectorProps> = ({ frame, onDecision }) => {
  if (!frame) {
    return (
      <aside className="w-64 shrink-0 bg-[#14161A] border-l border-white/10 p-4 hidden lg:flex flex-col justify-between">
        <div className="text-xs text-zinc-500">No frame selected</div>
      </aside>
    );
  }

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

  const decisionBadge =
    frame.decision === 'keep'
      ? {
          label: 'Keep',
          icon: <Check className="w-4 h-4" aria-hidden="true" />,
          cls: 'text-sky-300 border-sky-400/40 bg-sky-500/12',
        }
      : frame.decision === 'reject'
      ? {
          label: 'Reject',
          icon: <X className="w-4 h-4" aria-hidden="true" />,
          cls: 'text-orange-300 border-orange-400/40 bg-orange-500/12',
        }
      : {
          label: 'Unreviewed',
          icon: <CircleDashed className="w-4 h-4" aria-hidden="true" />,
          cls: 'text-zinc-300 border-white/10 bg-white/4',
        };

  return (
    <aside
      aria-label="Frame details and EXIF metadata"
      className="w-64 shrink-0 bg-[#14161A] border-l border-white/10 hidden lg:flex flex-col justify-between overflow-y-auto"
    >
      <div className="p-4 space-y-5">
        {/* Frame Header */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 font-mono tabular-nums">
            <span>#{String(frame.sequenceIndex).padStart(4, '0')}</span>
            {frame.burstGroupId ? (
              <span>
                Burst {frame.burstGroupId.replace('burst-', '')} · {frame.burstIndex}/
                {frame.burstCount}
              </span>
            ) : (
              <span>Single frame</span>
            )}
          </div>
          <h2 className="text-sm font-semibold text-zinc-100 truncate" title={frame.filename}>
            {frame.filename}
          </h2>
          {exif.formatLabel && (
            <p className="text-[11px] text-zinc-400">{exif.formatLabel}</p>
          )}
          {frame.demoVariant?.demoSceneLabel && (
            <p className="text-xs text-zinc-300 pt-0.5">{frame.demoVariant.demoSceneLabel}</p>
          )}
        </div>

        {/* Decision Selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Decision</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium ${decisionBadge.cls}`}
              data-testid="inspector-decision"
            >
              {decisionBadge.icon}
              <span>{decisionBadge.label}</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => onDecision(frame.id, 'keep')}
              aria-pressed={frame.decision === 'keep'}
              className={`py-1.5 px-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                frame.decision === 'keep'
                  ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                  : 'bg-[#1B1E24] border-white/10 text-zinc-300 hover:bg-[#23272F]'
              }`}
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Keep</span>
            </button>
            <button
              type="button"
              onClick={() => onDecision(frame.id, 'reject')}
              aria-pressed={frame.decision === 'reject'}
              className={`py-1.5 px-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-orange-400 ${
                frame.decision === 'reject'
                  ? 'bg-orange-500/20 border-orange-400/60 text-orange-200'
                  : 'bg-[#1B1E24] border-white/10 text-zinc-300 hover:bg-[#23272F]'
              }`}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reject</span>
            </button>
            <button
              type="button"
              onClick={() => onDecision(frame.id, 'unreviewed')}
              aria-pressed={frame.decision === 'unreviewed'}
              className={`py-1.5 px-2 rounded-md border text-xs font-medium flex items-center justify-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-zinc-400 ${
                frame.decision === 'unreviewed'
                  ? 'bg-white/12 border-white/30 text-zinc-100'
                  : 'bg-[#1B1E24] border-white/10 text-zinc-400 hover:bg-[#23272F]'
              }`}
            >
              <CircleDashed className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Factual EXIF Table (missing fields intentionally left blank) */}
        <div className="border-t border-white/8 pt-4">
          <h3 className="text-xs font-semibold text-zinc-300 mb-2.5">Camera Settings</h3>
          <dl className="space-y-2 text-xs">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-zinc-500 shrink-0">{row.label}</dt>
                <dd className="text-zinc-200 font-mono tabular-nums text-right truncate min-h-[1rem]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Read-only original assurance */}
      <div className="p-4 border-t border-white/8 text-[11px] text-zinc-500 flex items-start gap-2">
        <HardDrive className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <span>
          Originals stay read-only. Decisions persist locally in your browser catalogue.
        </span>
      </div>
    </aside>
  );
};
