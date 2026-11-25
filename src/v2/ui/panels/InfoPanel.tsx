import React, { useEffect, useState } from 'react';
import VehicleRow from './VehicleRow';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { pictureSourceWords } from '../shell/PictureSourceBadge';

/** Brightness is solid; each colour channel also has its own dash pattern and name, so none is told apart by hue alone (WCAG 1.4.1). */
const HISTOGRAM_LINES = [
  { key: 'red', word: 'histogramRed', stroke: 'rgba(226,92,92,0.85)', width: 1.6, dash: '5 3' },
  { key: 'green', word: 'histogramGreen', stroke: 'rgba(56,178,139,0.85)', width: 1.6, dash: '0.5 3' },
  { key: 'blue', word: 'histogramBlue', stroke: 'rgba(78,168,222,0.85)', width: 1.6, dash: '8 2.5 0.5 2.5' },
  { key: 'luma', word: 'histogramBrightness', stroke: 'var(--text-primary)', width: 1.8, dash: undefined },
] as const;

interface InfoPanelProps {
  photo: Photo | null;
  onToggleFlag: (photoIds: string[]) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onReconnectOriginal: (photoId: string) => void;
  onSaveDngCopy?: (photoId: string) => void;
  onCorrectSpeciesName: (photoId: string, name: string) => void;
  onCorrectVehicle?: (photoId: string, choice: { kind: string; type?: string } | 'not-a-vehicle', wholeBurst: boolean) => void;
}

export default function InfoPanel({
  photo,
  onToggleFlag,
  onSetRating,
  onReconnectOriginal,
  onSaveDngCopy,
  onCorrectSpeciesName,
  onCorrectVehicle,
}: InfoPanelProps) {
  const [editingSpecies, setEditingSpecies] = useState(false);
  // The name alone: the label may carry a "(suggested)" marker in the person's language, which is not part of the name.
  const [speciesDraft, setSpeciesDraft] = useState(photo?.speciesName ?? photo?.speciesLabel ?? '');
  useEffect(() => {
    setEditingSpecies(false);
    setSpeciesDraft(photo?.speciesName ?? photo?.speciesLabel ?? '');
  }, [photo?.id, photo?.speciesLabel]);

  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToInspect}</p>;
  }

  const hist = photo.histogram ?? null;
  const pct = (fraction: number) => (fraction === 0 ? '0%' : fraction < 0.001 ? '<0.1%' : fraction >= 0.1 ? `${Math.round(fraction * 100)}%` : `${(fraction * 100).toFixed(1)}%`);
  const flagged = photo.decision === 'keep';
  const clippedChannels = HISTOGRAM_LINES.flatMap((line) => {
    const clip = line.key === 'luma' ? undefined : hist?.channelClip?.[line.key];
    return clip && (clip.shadow > 0 || clip.highlight > 0) ? [{ line, clip }] : [];
  });

  const toPolyline = (vals: number[]) =>
    vals
      .map((v, idx) => `${((idx / (vals.length - 1)) * 240).toFixed(1)},${(74 - (v / 100) * 68).toFixed(1)}`)
      .join(' ');

  return (
    <div className="space-y-4">
      {/* Live SVG Histogram */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[var(--text-primary)]">{STRINGS.panelWords.histogram}</span>
          <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">
            {photo.assistCritique.kelvinEstimate}
          </span>
        </div>
        {hist ? (
          <>
            <svg viewBox="0 0 240 76" className="mt-2 h-20 w-full" role="img" aria-label={STRINGS.panelWords.histogramLabel(pct(hist.shadowClip), pct(hist.highlightClip))}>
              {HISTOGRAM_LINES.map((line) => (
                <polyline key={line.key} data-channel={line.key} fill="none" stroke={line.stroke} strokeWidth={line.width}
                  strokeDasharray={line.dash} strokeLinecap="round" points={toPolyline(hist[line.key])} />
              ))}
            </svg>
            {/* Each line has its own pattern and a word, so the channels are told apart without relying on colour. */}
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6875rem] text-[var(--text-secondary)]" data-testid="histogram-legend">
              {HISTOGRAM_LINES.map((line) => (
                <li key={line.key} className="inline-flex items-center gap-1">
                  <svg width="18" height="6" viewBox="0 0 18 6" aria-hidden="true" focusable="false">
                    <line x1="1" y1="3" x2="17" y2="3" stroke={line.stroke} strokeWidth={line.width} strokeDasharray={line.dash} strokeLinecap="round" />
                  </svg>
                  {STRINGS.panelWords[line.word]}
                </li>
              ))}
            </ul>
            <p className="mt-1 flex justify-between text-[0.6875rem] text-[var(--text-secondary)]" data-testid="histogram-clipping">
              <span>Shadows clipped {pct(hist.shadowClip)}</span>
              <span>Highlights clipped {pct(hist.highlightClip)}</span>
            </p>
            {clippedChannels.length > 0 && (
              <ul className="mt-0.5 text-[0.6875rem] text-[var(--text-secondary)]" data-testid="histogram-channel-clipping">
                {clippedChannels.map(({ line, clip }) => (
                  <li key={line.key}>{STRINGS.panelWords.histogramChannelClip(STRINGS.panelWords[line.word], pct(clip.shadow), pct(clip.highlight))}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p role="status" className="mt-2 text-xs text-[var(--text-secondary)]">{STRINGS.panelWords.measuring}</p>
        )}
      </div>

      {/* Rating & Flag */}
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={STRINGS.panelWords.rateStars(n)}
              aria-pressed={n === photo.rating}
              onClick={() => onSetRating([photo.id], n === photo.rating ? 0 : n)}
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
          {photo.pairedJpeg && <MetaRow label={STRINGS.pair.infoLabel} value={photo.pairedJpeg} mono />}
          <MetaRow label="Format" value={photo.exif.fileSizeMb > 0 ? `${photo.exif.fileFormat} · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(photo.exif.fileSizeMb)} MB` : photo.exif.fileFormat} />
          {photo.picture?.preview && (() => { const words = pictureSourceWords(photo.picture.preview); return <MetaRow label={STRINGS.pictureSource.infoLabel} value={`${words.label}. ${words.detail}`} />; })()}
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
        {photo.dngCopy && photo.originalConnected && onSaveDngCopy && (
          <div className="mt-2 space-y-1">
            <button
              type="button"
              onClick={() => onSaveDngCopy(photo.id)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-xs font-medium text-[var(--text-primary)]"
            >
              <BrandIcon name="copy" size={14} />
              <span>{STRINGS.dngCopy.button}</span>
            </button>
            <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.dngCopy.help}</p>
          </div>
        )}
      </section>

      {/* Camera & Capture */}
      <section className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.cameraSection}</h3>
        <dl className="space-y-1.5 text-xs">
          <MetaRow label="Camera" value={photo.exif.camera} />
          <MetaRow label="Lens" value={photo.exif.lens} />
          <MetaRow label="Exposure" value={[photo.exif.aperture, photo.exif.shutter, photo.exif.iso > 0 ? `ISO ${photo.exif.iso}` : ''].filter(value => value && value !== 'Not recorded').join(' · ') || 'Not recorded'} mono />
          <MetaRow label="Focal length" value={photo.exif.focalLength} mono />
          <MetaRow label="Captured" value={photo.exif.capturedAt} />
        </dl>
      </section>

      {/* Analysis Summary */}
      <section className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.cullSection}</h3>
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <dt className="shrink-0 text-[var(--text-muted)]">{STRINGS.panelWords.subject}</dt>
            {editingSpecies ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap justify-end gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!speciesDraft.trim()) return;
                  onCorrectSpeciesName(photo.id, speciesDraft);
                  setEditingSpecies(false);
                }}
              >
                <input
                  type="text"
                  aria-label={STRINGS.panelWords.correctSpecies}
                  autoFocus
                  maxLength={120}
                  value={speciesDraft}
                  onChange={(event) => setSpeciesDraft(event.target.value)}
                  className="min-w-0 max-w-40 rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]"
                />
                <button type="submit" disabled={!speciesDraft.trim()} className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40">{STRINGS.panelWords.save}</button>
                <button type="button" onClick={() => setEditingSpecies(false)} className="rounded px-1 py-1">{STRINGS.panelWords.cancel}</button>
              </form>
            ) : (
              <dd className="flex min-w-0 items-center gap-2 text-right text-[var(--text-primary)]">
                <span>{photo.speciesLabel || photo.category || (photo.vehicleLabel ? '' : STRINGS.panelWords.notIdentified)}</span>
                <button type="button" aria-label={STRINGS.panelWords.correctSpecies} title={STRINGS.panelWords.correctSpecies}
                  onClick={() => setEditingSpecies(true)}
                  className="shrink-0 rounded border border-[var(--border-subtle)] px-2 py-1 text-[0.6875rem]">{STRINGS.panelWords.edit}</button>
              </dd>
            )}
          </div>
          {onCorrectVehicle && <VehicleRow photo={photo} onCorrect={onCorrectVehicle} />}
          <MetaRow label="Sharpness" value={`${photo.sharpnessScore}%`} mono />
          <MetaRow label={STRINGS.tier.label} value={photo.tier ? STRINGS.tier[photo.tier] : STRINGS.tier.notRanked} />
        </dl>
      </section>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className={`text-right text-[var(--text-primary)] ${mono ? 'font-mono text-[0.6875rem] tabular-nums' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
