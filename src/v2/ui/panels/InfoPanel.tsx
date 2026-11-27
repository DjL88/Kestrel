import React, { useEffect, useState } from 'react';
import { stackText } from '../../../i18n/areas/stack';
import { panoText } from '../../../i18n/areas/pano';
import VehicleRow from './VehicleRow';
import { hdrText } from '../../../i18n/areas/hdr';
import { stopsLabel } from '../../engineClient/hdrMergeOps';
import SpeciesPlaceRow from './SpeciesPlaceRow';
import SpeciesNameField from './SpeciesNameField';
import type { Photo, SpeciesPlace, WorkspaceStore } from '../contract';
import type { ExternalApp } from '../../../core/externalEdit';
import type { SpeciesArea } from '../../../core/speciesArea';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { pictureSourceWords } from '../shell/PictureSourceBadge';
import { photoTagsText } from '../../../i18n/areas/photoTags';

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
  /** Merge an exposure bracket into a new HDR photo (absent while the feature is off). */
  onHdrMerge?: (photoIds: string[]) => void;
  /** Edit in another app. Absent or null: not available here (the web), which the panel says in plain words. */
  externalEditor?: WorkspaceStore['externalEditor'];
  onEditInOtherApp?: (photoId: string, app: ExternalApp | 'choose' | 'default') => void;
  onStopExternalEdit?: (photoId: string) => void;
  onCorrectSpeciesName: (photoId: string, name: string) => void;
  onLookAgainAtSpecies?: (photoId: string) => void;
  onCorrectVehicle?: (photoId: string, choice: { kind: string; type?: string } | 'not-a-vehicle', wholeBurst: boolean) => void;
  onRemovePhotoTag?: (photoId: string, tagId: string) => void;
  speciesPlace?: SpeciesPlace | null;
  onSetSpeciesArea?: (area: SpeciesArea) => void;
}

export default function InfoPanel({
  photo,
  onToggleFlag,
  onSetRating,
  onReconnectOriginal,
  onSaveDngCopy,
  onHdrMerge,
  externalEditor,
  onEditInOtherApp,
  onStopExternalEdit,
  onCorrectSpeciesName,
  onLookAgainAtSpecies,
  onCorrectVehicle,
  onRemovePhotoTag,
  speciesPlace,
  onSetSpeciesArea,
}: InfoPanelProps) {
  const [editingSpecies, setEditingSpecies] = useState(false);
  // Owner, 26 Nov: the camera and analysis first; the histogram and the file on a second tab. Kept while photos change.
  const [view, setView] = useState<'details' | 'file'>('details');
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

  const views = [
    { id: 'details', label: STRINGS.info.tabDetails },
    { id: 'file', label: STRINGS.info.tabFile },
  ] as const;
  const onTabKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'details' : event.key === 'End' ? 'file' : view === 'details' ? 'file' : 'details';
    setView(next);
    document.getElementById(`info-tab-${next}`)?.focus();
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={STRINGS.info.tabsLabel} className="flex gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5" onKeyDown={onTabKey}>
        {views.map((tab) => (
          <button key={tab.id} id={`info-tab-${tab.id}`} type="button" role="tab" aria-selected={view === tab.id}
            aria-controls={`info-view-${tab.id}`} tabIndex={view === tab.id ? 0 : -1} onClick={() => setView(tab.id)}
            className={`h-7 flex-1 rounded-[var(--radius-sm)] px-2 text-xs font-medium ${view === tab.id ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)] underline decoration-2 underline-offset-4' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'file' && (
      <div id="info-view-file" role="tabpanel" aria-labelledby="info-tab-file" className="space-y-4">
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
              {/* For a RAW, say which picture the measurement came from: the 16-bit develop, or the 8-bit picture on screen. */}
              {photo.picture?.preview && (
                <p className="mt-0.5 text-[0.6875rem] text-[var(--text-muted)]" data-testid="histogram-precision" data-precision={hist.precision ?? 'rgb8'}>
                  {hist.precision === 'rgb16' ? STRINGS.pictureSource.histogram16 : STRINGS.pictureSource.histogram8}
                </p>
              )}
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

        {/* File & Original Link */}
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.fileSection}</h3>
          <dl className="space-y-1.5 text-xs">
            <MetaRow label="File" value={photo.filename} mono />
            {photo.pairedJpeg && <MetaRow label={STRINGS.pair.infoLabel} value={photo.pairedJpeg} mono />}
            {photo.externalEdit && <MetaRow label={STRINGS.externalEdit.infoLabel} value={externalEditHistory(photo.externalEdit)} />}
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
          {photo.panorama && (
            <div className="mt-2 space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2" data-testid="v2-panorama-info">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{panoText.infoTitle}</p>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{panoText.infoMadeFrom(photo.panorama.sources.length)}</p>
              <ul className="list-disc pl-4 text-[0.6875rem] text-[var(--text-secondary)]">
                {photo.panorama.sources.map((name, i) => <li key={`${i}-${name}`} className="break-all">{name}</li>)}
              </ul>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{panoText.infoHow}</p>
            </div>
          )}
          {photo.focusStack && (
            <div className="mt-2 space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2" data-testid="v2-focus-stack-info">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{stackText.infoTitle}</p>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{stackText.infoMadeFrom(photo.focusStack.sources.length)}</p>
              <ul className="list-disc pl-4 text-[0.6875rem] text-[var(--text-secondary)]">
                {photo.focusStack.sources.map((name, i) => <li key={`${i}-${name}`} className="break-all">{name}</li>)}
              </ul>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{stackText.infoHow}</p>
            </div>
          )}
          {photo.hdrMerge && (
            <div className="mt-2 space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2" data-testid="v2-hdr-merge-info">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{hdrText.infoTitle}</p>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{hdrText.infoMadeFrom(photo.hdrMerge.sources.length)}</p>
              <ul className="list-disc pl-4 text-[0.6875rem] text-[var(--text-secondary)]">
                {photo.hdrMerge.sources.map((source, i) => <li key={`${i}-${source.filename}`} className="break-all">{hdrText.infoExposure(source.filename, stopsLabel(source.ev))}</li>)}
              </ul>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{hdrText.infoHow}</p>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{hdrText.whatIs}</p>
            </div>
          )}
          {photo.bracket && onHdrMerge && !photo.hdrMerge && (
            <div className="mt-2 space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2" data-testid="v2-hdr-bracket-info">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{hdrText.bracketTitle}</p>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">
                {hdrText.bracketFound(photo.bracket.photoIds.length, photo.bracket.ev.map(stopsLabel).join(', '))}{' '}
                {photo.bracket.fromCamera ? hdrText.bracketFromCamera : hdrText.bracketFromExposures}
              </p>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{hdrText.whatIs}</p>
              <button type="button" onClick={() => onHdrMerge(photo.bracket!.photoIds)} title={hdrText.menuHint}
                className="mt-1 inline-flex h-8 w-full items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-xs font-medium text-[var(--text-primary)]">
                {hdrText.menu(photo.bracket.photoIds.length)}
              </button>
            </div>
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
          <ExternalEditBlock photo={photo} editor={externalEditor} onSend={onEditInOtherApp} onStop={onStopExternalEdit} />
        </section>

      </div>
      )}

      {view === 'details' && (
      <div id="info-view-details" role="tabpanel" aria-labelledby="info-tab-details" className="space-y-4">
      {/* The original going missing is never hidden on the other tab. */}
      {!photo.originalConnected && (
        <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2" data-testid="info-original-offline">
          <p role="status" className="text-xs text-[var(--text-primary)]">{STRINGS.info.originalStatusOffline}</p>
          <button
            type="button"
            onClick={() => onReconnectOriginal(photo.id)}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-xs font-medium text-[var(--text-primary)]"
          >
            <BrandIcon name="relink" size={14} />
            <span>{STRINGS.canvas.reconnectOriginal}</span>
          </button>
        </div>
      )}
      {/* Camera & Capture */}
      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.info.cameraSection}</h3>
        <dl className="space-y-1.5 text-xs">
          <MetaRow label="Camera" value={photo.exif.camera} />
          <MetaRow label="Lens" value={photo.exif.lens} />
          <MetaRow label="Exposure" value={[photo.exif.aperture, photo.exif.shutter, photo.exif.iso > 0 ? `ISO ${photo.exif.iso}` : ''].filter(value => value && value !== 'Not recorded').join(' · ') || 'Not recorded'} mono />
          <MetaRow label="Focal length" value={photo.exif.focalLength} mono />
          <MetaRow label="Captured" value={photo.exif.capturedAt} />
          {photo.cameraFocus && (
            <div className="flex items-start justify-between gap-3" data-testid="camera-focus">
              <dt className="shrink-0 text-[var(--text-muted)]">{STRINGS.info.cameraFocusRow}</dt>
              <dd className="text-right">
                <span className="text-[var(--text-primary)]">{photo.cameraFocus.label}</span>
                <span className="block text-[0.6875rem] text-[var(--text-secondary)]">{photo.cameraFocus.detail}</span>
              </dd>
            </div>
          )}
          {photo.editStatus && (
            <div className="flex items-start justify-between gap-3" data-testid="edit-status">
              <dt className="shrink-0 text-[var(--text-muted)]">{STRINGS.info.editStatusRow}</dt>
              <dd className="text-right">
                <span className="text-[var(--text-primary)]">{photo.editStatus.label}</span>
                <span className="block text-[0.6875rem] text-[var(--text-secondary)]">{photo.editStatus.detail}</span>
              </dd>
            </div>
          )}
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
                <SpeciesNameField
                  label={STRINGS.panelWords.correctSpecies}
                  value={speciesDraft}
                  onChange={setSpeciesDraft}
                  className="w-full min-w-0 rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]"
                />
                <button type="submit" disabled={!speciesDraft.trim()} className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40">{STRINGS.panelWords.save}</button>
                <button type="button" onClick={() => setEditingSpecies(false)} className="rounded px-1 py-1">{STRINGS.panelWords.cancel}</button>
              </form>
            ) : (
              <dd className="flex min-w-0 items-center gap-2 text-right text-[var(--text-primary)]">
                <span className="flex flex-col items-end">
                  <span>{photo.speciesLabel || photo.category || (photo.vehicleLabel ? '' : STRINGS.panelWords.notIdentified)}</span>
                  {photo.speciesAreaLabel && <span data-testid="species-area-used" className="text-[0.6875rem] text-[var(--text-secondary)]">{photo.speciesAreaLabel}</span>}
                </span>
                <button type="button" aria-label={STRINGS.panelWords.correctSpecies} title={STRINGS.panelWords.correctSpecies}
                  onClick={() => setEditingSpecies(true)}
                  className="shrink-0 rounded border border-[var(--border-subtle)] px-2 py-1 text-[0.6875rem]">{STRINGS.panelWords.edit}</button>
                {/* An automatic name only: take it off for good and let the species check look again (Dave, 27 Nov). */}
                {photo.speciesAuto && onLookAgainAtSpecies && (
                  <button type="button" data-testid="species-look-again" onClick={() => onLookAgainAtSpecies(photo.id)}
                    title={STRINGS.panelWords.lookAgainHelp}
                    className="shrink-0 rounded border border-[var(--border-subtle)] px-2 py-1 text-[0.6875rem]">{STRINGS.panelWords.lookAgain}</button>
                )}
              </dd>
            )}
          </div>
          {onCorrectVehicle && <VehicleRow photo={photo} onCorrect={onCorrectVehicle} />}
          <MetaRow label="Sharpness" value={`${photo.sharpnessScore}%`} mono />
          <MetaRow label={STRINGS.tier.label} value={photo.tier ? STRINGS.tier[photo.tier] : STRINGS.tier.notRanked} />
        </dl>
        {speciesPlace && onSetSpeciesArea && (
          <div className="mt-3"><SpeciesPlaceRow place={speciesPlace} onChange={onSetSpeciesArea} /></div>
        )}
      </section>
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

      {photo.photoTags && photo.photoTags.length > 0 && (
        <section aria-label={photoTagsText.foundHeading} data-testid="photo-tags">
          <h3 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{photoTagsText.foundHeading}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {photo.photoTags.map((tag) => (
              <li key={tag.id} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-primary)]">
                <span><span className="text-[var(--text-muted)]">{(photoTagsText.facets as Record<string, string>)[tag.facet]}: </span>{tag.label}</span>
                {onRemovePhotoTag && (
                  <button type="button" aria-label={photoTagsText.remove(tag.label)} title={photoTagsText.remove(tag.label)}
                    onClick={() => onRemovePhotoTag(photo.id, tag.id)}
                    className="rounded px-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">×</button>
                )}
              </li>
            ))}
          </ul>
          {photo.photoTags.some((tag) => tag.facet === 'place') && (
            <p className="mt-2 text-[0.6875rem] text-[var(--text-muted)]">{photoTagsText.placeNote}</p>
          )}
        </section>
      )}
      </div>
      )}
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

/** Where a photo brought back from another editor came from, in plain words. */
function externalEditHistory(record: NonNullable<Photo['externalEdit']>): string {
  const words = STRINGS.externalEdit;
  const when = new Date(record.returnedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const profile = record.savedProfile === undefined ? null
    : record.savedProfile === null ? words.historyNoProfile : words.historyProfile(record.savedProfile);
  return [words.history(record.appName, record.fromFilename, when), words.historySteps(record.stepsSent), words.historyBits(record.sentBits, record.savedBits), profile].filter(Boolean).join(' ');
}

/** "Edit in another app": the remembered apps, choose another, or the default; then what is happening while it is out. */
function ExternalEditBlock({ photo, editor, onSend, onStop }: {
  photo: Photo;
  editor: WorkspaceStore['externalEditor'];
  onSend?: (photoId: string, app: ExternalApp | 'choose' | 'default') => void;
  onStop?: (photoId: string) => void;
}) {
  const words = STRINGS.externalEdit;
  const button = 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-xs font-medium text-[var(--text-primary)] disabled:opacity-60';
  if (!editor || !onSend) {
    return (
      <div className="mt-2 space-y-1" data-testid="external-edit-unavailable">
        <button type="button" disabled aria-describedby={`external-edit-why-${photo.id}`} className={button}>
          <BrandIcon name="export" size={14} />
          <span>{words.title}</span>
        </button>
        <p id={`external-edit-why-${photo.id}`} className="text-[0.6875rem] text-[var(--text-secondary)]">{words.unavailable}</p>
      </div>
    );
  }
  const out = editor.watching[photo.id];
  if (out) {
    const status = out.state === 'sending' ? words.sending
      : out.state === 'bringing-back' ? words.bringingBack
        : out.state === 'saving' ? words.saving(out.appName) : words.waiting(out.appName);
    return (
      <div className="mt-2 space-y-1" data-testid="external-edit-watching">
        <p role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">
          {status}{out.returned > 0 ? ` ${words.returnedCount(out.returned)}` : ''}
        </p>
        {out.state !== 'sending' && onStop && (
          <button type="button" onClick={() => onStop(photo.id)} className={button}>
            <BrandIcon name="close" size={14} />
            <span>{words.stop}</span>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1" data-testid="external-edit">
      <h4 className="text-xs font-medium text-[var(--text-primary)]">{words.title}</h4>
      {editor.apps.map((app) => (
        <button key={app.path} type="button" disabled={!photo.originalConnected} onClick={() => onSend(photo.id, app)} className={button}>
          <BrandIcon name="export" size={14} />
          <span>{words.openIn(app.name)}</span>
        </button>
      ))}
      <button type="button" disabled={!photo.originalConnected} onClick={() => onSend(photo.id, 'choose')} className={button}>
        <BrandIcon name="folder-open" size={14} />
        <span>{words.chooseApp}</span>
      </button>
      <button type="button" disabled={!photo.originalConnected} onClick={() => onSend(photo.id, 'default')} className={button}>
        <BrandIcon name="export" size={14} />
        <span>{words.defaultApp}</span>
      </button>
      <p className="text-[0.6875rem] text-[var(--text-secondary)]">{words.help}</p>
    </div>
  );
}
