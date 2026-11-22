import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { buildHistogramData, getActiveGroup } from '../utils/studioMath';

interface InfoPanelProps {
  photo: Photo | null;
  onToggleFlag: (photoIds: string[]) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onReconnectOriginal: (photoId: string) => void;
}

export default function InfoPanel({
  photo,
  onToggleFlag,
  onSetRating,
  onReconnectOriginal,
}: InfoPanelProps) {
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to inspect metadata.</p>;
  }

  const group = getActiveGroup(photo);
  const seed = photo.id.charCodeAt(photo.id.length - 1);
  const hist = buildHistogramData(group.recipe, seed);
  const flagged = photo.decision === 'keep';

  const toPolyline = (vals: number[]) =>
    vals
      .map((v, idx) => `${((idx / (vals.length - 1)) * 240).toFixed(1)},${(74 - (v / 100) * 68).toFixed(1)}`)
      .join(' ');

  return (
    <div className="space-y-4">
      {/* Live SVG Histogram */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[var(--text-primary)]">Histogram</span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {photo.assistCritique.kelvinEstimate}
          </span>
        </div>
        <svg viewBox="0 0 240 76" className="mt-2 h-20 w-full" role="img" aria-label="Tonal histogram">
          <polyline fill="none" stroke="rgba(226,92,92,0.58)" strokeWidth="1.6" points={toPolyline(hist.red)} />
          <polyline fill="none" stroke="rgba(56,178,139,0.58)" strokeWidth="1.6" points={toPolyline(hist.green)} />
          <polyline fill="none" stroke="rgba(78,168,222,0.62)" strokeWidth="1.6" points={toPolyline(hist.blue)} />
          <polyline fill="none" stroke="var(--text-primary)" strokeWidth="1.7" points={toPolyline(hist.luma)} />
        </svg>
      </div>

      {/* Rating & Flag */}
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Rate ${n} stars`}
              onClick={() => onSetRating([photo.id], n)}
              className="p-1"
            >
              <BrandIcon
                name={n <= photo.rating ? 'star-filled' : 'star-empty'}
                size={15}
                className={n <= photo.rating ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onToggleFlag([photo.id])}
          className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
            flagged
              ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
              : 'bg-[var(--bg-surface)] text-[var(--text-secondary)]'
          }`}
        >
          <BrandIcon name={flagged ? 'flag' : 'flag-off'} size={13} />
          <span>{flagged ? 'Flagged' : 'Flag'}</span>
        </button>
      </div>

      {/* File & Original Link */}
      <section className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.fileSection}</h3>
        <dl className="space-y-1.5 text-xs">
          <MetaRow label="File" value={photo.filename} mono />
          <MetaRow label="Format" value={`${photo.exif.fileFormat} · ${photo.exif.fileSizeMb} MB`} />
          <MetaRow label="Dimensions" value={photo.exif.dimensions} mono />
          <MetaRow label="Colour profile" value={photo.exif.colourProfile} />
          <MetaRow
            label="Original"
            value={
              photo.originalConnected
                ? STRINGS.info.originalStatusConnected
                : STRINGS.info.originalStatusOffline
            }
          />
        </dl>
        {!photo.originalConnected && (
          <button
            type="button"
            onClick={() => onReconnectOriginal(photo.id)}
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-xs font-medium text-[var(--text-primary)]"
          >
            <BrandIcon name="relink" size={14} />
            <span>{STRINGS.canvas.reconnectOriginal}</span>
          </button>
        )}
      </section>

      {/* Camera & Capture */}
      <section className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.cameraSection}</h3>
        <dl className="space-y-1.5 text-xs">
          <MetaRow label="Camera" value={photo.exif.camera} />
          <MetaRow label="Lens" value={photo.exif.lens} />
          <MetaRow label="Exposure" value={`${photo.exif.aperture} · ${photo.exif.shutter} · ISO ${photo.exif.iso}`} mono />
          <MetaRow label="Focal length" value={photo.exif.focalLength} mono />
          <MetaRow label="Captured" value={photo.exif.capturedAt} />
        </dl>
      </section>

      {/* Analysis Summary */}
      <section className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.cullSection}</h3>
        <dl className="space-y-1.5 text-xs">
          <MetaRow label="Subject" value={photo.speciesLabel || photo.category} />
          <MetaRow label="Sharpness" value={`${photo.sharpnessScore}%`} mono />
        </dl>
      </section>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className={`text-right text-[var(--text-primary)] ${mono ? 'font-mono text-[11px] tabular-nums' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
