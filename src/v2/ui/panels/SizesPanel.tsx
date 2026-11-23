import React, { useState } from 'react';
import type { CropTransform, FeatureKey, Photo, VideoZoomConfig } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { useProHidden } from '../shell/ProBadge';
import InfoPopover from '../shell/InfoPopover';
import { getActiveGroup } from '../utils/studioMath';
import { dimensionPixels, paperDimensions, type DimensionUnit, type PaperOrientation, type PaperPreset } from '../../engineClient/paperSizes';

interface SizesPanelProps {
  photo: Photo | null;
  activeSizeId: string;
  selectedSizeIds: string[];
  canvasLayoutMode: 'single' | 'all-formats';
  features: Record<FeatureKey, boolean>;
  onSetActiveGroup: (photoId: string, groupId: string) => void;
  onAddEditGroup: (photoId: string) => void;
  onSetActiveSize: (sizeId: string, modifiers?: { ctrl?: boolean }) => void;
  onSetCanvasLayoutMode: (mode: 'single' | 'all-formats') => void;
  onToggleSizeEnabled: (photoId: string, sizeId: string) => void;
  onToggleSizeLinked: (photoId: string, sizeId: string) => void;
  onUpdateSizeCrop: (photoId: string, sizeId: string, patch: Partial<CropTransform>) => void;
  onFlipSizes: (photoId: string, axis: 'horizontal' | 'vertical') => void;
  onRotateSizes: (photoId: string) => void;
  onResetSizeCrop: (photoId: string, sizeId: string) => void;
  onAddCustomSize: (photoId: string, label: string, width: number, height: number) => void;
  onToggleSplitFrames: (photoId: string) => void;
  onUpdateVideoZoom: (photoId: string, patch: Partial<VideoZoomConfig>) => void;
}

export default function SizesPanel({
  photo,
  activeSizeId,
  selectedSizeIds,
  canvasLayoutMode,
  features,
  onSetActiveGroup,
  onAddEditGroup,
  onSetActiveSize,
  onSetCanvasLayoutMode,
  onToggleSizeEnabled,
  onToggleSizeLinked,
  onUpdateSizeCrop,
  onFlipSizes,
  onRotateSizes,
  onResetSizeCrop,
  onAddCustomSize,
  onToggleSplitFrames,
  onUpdateVideoZoom,
}: SizesPanelProps) {
  const hideVideoPro = useProHidden('zoomVideo');
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customW, setCustomW] = useState(2400);
  const [customH, setCustomH] = useState(1600);
  const [customUnit, setCustomUnit] = useState<DimensionUnit>('px');
  const [customPpi, setCustomPpi] = useState(300);
  const [paperPreset, setPaperPreset] = useState<PaperPreset>('custom');
  const [paperOrientation, setPaperOrientation] = useState<PaperOrientation>('portrait');

  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to manage export formats.</p>;
  }

  const group = getActiveGroup(photo);
  const activeSize = photo.sizes.find((s) => s.id === activeSizeId) ?? photo.sizes[0];

  const pixelDimensions = dimensionPixels(customW, customH, customUnit, customPpi);
  const handlePaperPreset = (preset: PaperPreset) => {
    setPaperPreset(preset);
    if (preset !== 'custom') {
      const size = paperDimensions(preset, paperOrientation);
      setCustomUnit('mm');
      setCustomW(size.width);
      setCustomH(size.height);
    }
  };
  const changeOrientation = (orientation: PaperOrientation) => {
    if (paperOrientation !== orientation) {
      setCustomW(customH);
      setCustomH(customW);
    }
    setPaperOrientation(orientation);
  };
  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pixelDimensions) return;
    onAddCustomSize(photo.id, customLabel.trim() || (paperPreset !== 'custom' ? `${paperPreset} ${paperOrientation}` : `${pixelDimensions.width}×${pixelDimensions.height}`),
      pixelDimensions.width, pixelDimensions.height);
    setCustomLabel('');
    setAddingCustom(false);
  };

  return (
    <div className="space-y-5">
      {/* Side-by-side All Formats Board switch */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">Canvas view</span>
          <InfoPopover
            title="All Formats Board"
            body="View every active size export side-by-side on one canvas, move boards around freely, and zoom in to inspect details."
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onSetCanvasLayoutMode('single')}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
              canvasLayoutMode === 'single'
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="image" size={14} />
            <span>Single focus</span>
          </button>
          <button
            type="button"
            onClick={() => onSetCanvasLayoutMode('all-formats')}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
              canvasLayoutMode === 'all-formats'
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="all-sizes" size={14} />
            <span>All side-by-side</span>
          </button>
        </div>
      </div>

      {/* Edit Groups */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
              {STRINGS.formats.editGroupsHeading}
            </h3>
            <InfoPopover title="Edit Groups" body={STRINGS.formats.editGroupHint} />
          </div>
          <button
            type="button"
            onClick={() => onAddEditGroup(photo.id)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-accent)] hover:underline"
          >
            <BrandIcon name="plus" size={12} />
            <span>{STRINGS.formats.addEditGroup}</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {photo.editGroups.map((g) => {
            const isCurrent = g.id === group.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onSetActiveGroup(photo.id, g.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-xs transition-colors ${
                  isCurrent
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                }`}
              >
                <span className="truncate font-medium">{g.name}</span>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                  {g.overlay.textEnabled ? 'Text on' : 'Clean'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Format Presets List */}
      <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">Export formats</h3>
          <button
            type="button"
            onClick={() => setAddingCustom((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--brand-accent)]"
          >
            <BrandIcon name="plus" size={12} />
            <span>{STRINGS.formats.customSizeAdd}</span>
          </button>
        </div>

        {addingCustom && (
          <form
            onSubmit={handleCreateCustom}
            className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] p-2.5"
          >
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Format label (e.g. A3 Print)"
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                <span>Size</span>
                <select
                  aria-label="Paper size"
                  value={paperPreset}
                  onChange={(e) => handlePaperPreset(e.target.value as PaperPreset)}
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="custom">Custom</option>
                  <option value="A4">A4 (210 × 297 mm)</option>
                  <option value="A3">A3 (297 × 420 mm)</option>
                  <option value="A2">A2 (420 × 594 mm)</option>
                  <option value="A1">A1 (594 × 841 mm)</option>
                </select>
              </label>
              <label className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                <span>Orientation</span>
                <select
                  value={paperOrientation}
                  onChange={(e) => changeOrientation(e.target.value as PaperOrientation)}
                  aria-label="Canvas orientation"
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                <span>Width</span>
                <input
                  type="number" min={customUnit === 'px' ? 100 : 0.1} step={customUnit === 'px' ? 1 : 'any'}
                  value={customW}
                  onChange={(e) => { setCustomW(Number(e.target.value)); setPaperPreset('custom'); }}
                  aria-label={`Width in ${customUnit}`}
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)]"
                />
              </label>
              <label className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                <span>Height</span>
                <input
                  type="number" min={customUnit === 'px' ? 100 : 0.1} step={customUnit === 'px' ? 1 : 'any'}
                  value={customH}
                  onChange={(e) => { setCustomH(Number(e.target.value)); setPaperPreset('custom'); }}
                  aria-label={`Height in ${customUnit}`}
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)]"
                />
              </label>
              <label className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                <span>Units</span>
                <select
                  aria-label="Size units" value={customUnit}
                  onChange={(e) => {
                    const next = e.target.value as DimensionUnit;
                    const inches = customUnit === 'mm' ? 1 / 25.4 : customUnit === 'cm' ? 1 / 2.54 : customUnit === 'px' ? 1 / customPpi : 1;
                    const factor = next === 'mm' ? 25.4 : next === 'cm' ? 2.54 : next === 'px' ? customPpi : 1;
                    setCustomW(Number((customW * inches * factor).toFixed(next === 'px' ? 0 : 3)));
                    setCustomH(Number((customH * inches * factor).toFixed(next === 'px' ? 0 : 3)));
                    setCustomUnit(next);
                    setPaperPreset('custom');
                  }}
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="px">px</option><option value="mm">mm</option>
                  <option value="cm">cm</option><option value="in">in</option>
                </select>
              </label>
            </div>
            {customUnit !== 'px' && (
              <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                <span>Print resolution (PPI)</span>
                <input
                  type="number" min={1} max={2400} step={1} value={customPpi}
                  onChange={(e) => setCustomPpi(Number(e.target.value))}
                  aria-label="Print resolution in pixels per inch"
                  className="h-8 w-24 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)]"
                />
              </label>
            )}
            <p aria-live="polite" className="text-[11px] text-[var(--text-secondary)]">
              {pixelDimensions
                ? `Output canvas: ${pixelDimensions.width} × ${pixelDimensions.height} pixels. This does not add detail to a low-resolution photograph.`
                : 'Choose a size of 100 to 20,000 pixels per side and a valid PPI.'}
            </p>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setAddingCustom(false)}
                className="h-7 rounded px-2 text-xs text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!pixelDimensions}
                className="h-7 rounded bg-[var(--brand-accent)] px-2.5 text-xs font-semibold text-[var(--text-on-accent)] disabled:opacity-50"
              >
                Add format
              </button>
            </div>
          </form>
        )}

        <div className="space-y-1.5">
          {photo.sizes.filter((size) => !(size.kind === 'video' && !features.zoomVideo && hideVideoPro)).map((size) => {
            const isSelected = selectedSizeIds.includes(size.id);
            const isVideoLocked = size.kind === 'video' && !features.zoomVideo;
            return (
              <div
                key={size.id}
                className={`flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 transition-colors ${
                  isSelected
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                }`}
              >
                <button
                  type="button"
                  disabled={isVideoLocked}
                  aria-label={`Include ${size.label}`}
                  onClick={() => onToggleSizeEnabled(photo.id, size.id)}
                  className="text-[var(--text-secondary)] hover:text-[var(--brand-accent)] disabled:opacity-40"
                >
                  <BrandIcon
                    name={size.enabled ? 'checkbox-checked' : 'checkbox-empty'}
                    size={15}
                    className={size.enabled ? 'text-[var(--brand-accent)]' : ''}
                  />
                </button>

                <button
                  type="button"
                  disabled={isVideoLocked}
                  onClick={(e) => onSetActiveSize(size.id, { ctrl: e.ctrlKey || e.metaKey })}
                  className="flex flex-1 items-center justify-between gap-2 min-w-0 text-left disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <BrandIcon
                      name={
                        size.kind === 'video'
                          ? 'video-zoom'
                          : size.ratioLabel === '4:5'
                          ? 'ratio-4x5'
                          : 'ratio-16x9'
                      }
                      size={14}
                      className="text-[var(--text-muted)]"
                    />
                    <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                      {size.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                    {size.ratioLabel}
                  </span>
                </button>

                <button
                  type="button"
                  title={size.linked ? 'Paper-clipped to Edit Group' : 'Independent edit'}
                  aria-label={`Toggle paper-clip link for ${size.label}`}
                  onClick={() => onToggleSizeLinked(photo.id, size.id)}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
                    size.linked
                      ? 'text-[var(--brand-accent)] hover:bg-[var(--bg-surface)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface)]'
                  }`}
                >
                  <BrandIcon name={size.linked ? 'link' : 'unlink'} size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-format Custom Crop, Zoom, Flip & Rotate */}
      <section className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
              {STRINGS.formats.cropZoomHeading}
            </h3>
            <InfoPopover
              title="Individual vs Group Format Edits"
              body="When 1 format is selected, flip, rotate, and crop apply ONLY to that format. Ctrl/Cmd-click multiple formats to edit them together as a group."
            />
          </div>
          <button
            type="button"
            onClick={() => onResetSizeCrop(photo.id, activeSize.id)}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--brand-accent)]"
          >
            {STRINGS.formats.resetCrop}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => onFlipSizes(photo.id, 'horizontal')}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] border text-[11px] font-medium transition-colors ${
              activeSize.crop.flipH
                ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="arrows-horizontal" size={13} />
            <span>Flip H</span>
          </button>
          <button
            type="button"
            onClick={() => onFlipSizes(photo.id, 'vertical')}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] border text-[11px] font-medium transition-colors ${
              activeSize.crop.flipV
                ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="arrows-horizontal" size={13} className="rotate-90" />
            <span>Flip V</span>
          </button>
          <button
            type="button"
            onClick={() => onRotateSizes(photo.id)}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="rotate" size={13} />
            <span>90°</span>
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="format-zoom-slider" className="text-[var(--text-secondary)]">
              {STRINGS.formats.zoomLabel} ({activeSize.ratioLabel})
            </label>
            <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
              {Math.round(activeSize.crop.zoom * 100)}%
            </span>
          </div>
          <input
            id="format-zoom-slider"
            type="range"
            min={1}
            max={2.6}
            step={0.05}
            value={activeSize.crop.zoom}
            onChange={(e) => onUpdateSizeCrop(photo.id, activeSize.id, { zoom: Number(e.target.value) })}
            className="inflight-slider"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="format-border-slider" className="text-[var(--text-secondary)]">{STRINGS.formats.borderLabel} ({activeSize.ratioLabel})</label>
            <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">{(activeSize.crop.borderWidth ?? 0) > 0 ? `${activeSize.crop.borderWidth}%` : STRINGS.formats.borderNone}</span>
          </div>
          <input
            id="format-border-slider"
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={activeSize.crop.borderWidth ?? 0}
            onChange={(e) => onUpdateSizeCrop(photo.id, activeSize.id, { borderWidth: Number(e.target.value) })}
            className="inflight-slider"
          />
          <label className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span>Border placement</span>
            <select aria-label="Border placement" value={activeSize.crop.borderPlacement ?? 'all'}
              onChange={(e) => onUpdateSizeCrop(photo.id, activeSize.id, { borderPlacement: e.target.value as CropTransform['borderPlacement'] })}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]">
              <option value="all">All sides</option>
              <option value="horizontal">Top and bottom</option>
              <option value="vertical">Left and right</option>
              <option value="auto">Fit whole photo</option>
            </select>
          </label>
          <div role="group" aria-label={STRINGS.formats.borderColourLabel} className="flex flex-wrap items-center gap-2">
            {([['#ffffff', STRINGS.formats.borderWhite], ['#000000', STRINGS.formats.borderBlack], ['#f3f1e9', 'Warm white'], ['#383d43', 'Charcoal'], ['#d8cbb9', 'Sand'], ['#193c45', 'Deep teal']] as const).map(([hex, name]) => (
              <button
                key={hex}
                type="button"
                aria-pressed={(activeSize.crop.borderColour ?? '#ffffff') === hex}
                onClick={() => onUpdateSizeCrop(photo.id, activeSize.id, { borderColour: hex })}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-[11px] font-medium ${(activeSize.crop.borderColour ?? '#ffffff') === hex ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'}`}
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-full border border-[var(--border-default)]" style={{ background: hex }} />
                {name}
              </button>
            ))}
            <input
              type="color"
              aria-label={STRINGS.formats.borderColourLabel}
              value={activeSize.crop.borderColour ?? '#ffffff'}
              onChange={(e) => onUpdateSizeCrop(photo.id, activeSize.id, { borderColour: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-[var(--border-subtle)] bg-transparent p-0.5"
            />
          </div>
        </div>
      </section>

      {/* Split Panorama / 2 Equal Frames */}
      {features.splitFrames && (
        <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.formats.splitHeading} · {activeSize.label}
          </h3>
          <button
            type="button"
            onClick={() => onToggleSplitFrames(photo.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium transition-colors ${
              photo.formatSplits?.[activeSize.id]?.enabled === true
                ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className="flex items-center gap-2">
              <BrandIcon name="split-panorama" size={15} />
              <span>{STRINGS.formats.splitToggle}</span>
            </span>
            <span>{photo.formatSplits?.[activeSize.id]?.enabled === true ? 'On' : 'Off'}</span>
          </button>
        </section>
      )}

      {/* Video (Zoom MP4) Settings */}
      {features.zoomVideo && (
        <section className="space-y-2.5 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <BrandIcon name="video-zoom" size={14} className="text-[var(--brand-accent)]" />
              <span>{STRINGS.formats.videoHeading}</span>
            </h3>
            <button
              type="button"
              onClick={() => {
                onUpdateVideoZoom(photo.id, { enabled: !photo.videoZoom.enabled });
                if (!photo.videoZoom.enabled) onSetActiveSize('video-zoom');
              }}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                photo.videoZoom.enabled
                  ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                  : 'bg-[var(--bg-input)] text-[var(--text-muted)]'
              }`}
            >
              {photo.videoZoom.enabled ? 'Enabled' : 'Enable'}
            </button>
          </div>

          <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.formats.videoPinHint}</p>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => {
                onUpdateVideoZoom(photo.id, { enabled: true, direction: 'in' });
                onSetActiveSize('video-zoom');
              }}
              className={`h-8 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors ${
                photo.videoZoom.direction === 'in'
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
              }`}
            >
              {STRINGS.formats.videoDirectionIn}
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateVideoZoom(photo.id, { enabled: true, direction: 'out' });
                onSetActiveSize('video-zoom');
              }}
              className={`h-8 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors ${
                photo.videoZoom.direction === 'out'
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
              }`}
            >
              {STRINGS.formats.videoDirectionOut}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>
              Focal pin: <strong className="font-mono text-[var(--text-secondary)]">{photo.videoZoom.focalX}%, {photo.videoZoom.focalY}%</strong>
            </span>
            <label className="flex items-center gap-1.5">
              <span>Length</span>
              <select
                value={photo.videoZoom.durationSec}
                onChange={(e) => onUpdateVideoZoom(photo.id, { durationSec: Number(e.target.value) })}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
              >
                <option value={4}>4s</option>
                <option value={6}>6s</option>
                <option value={8}>8s</option>
                <option value={12}>12s</option>
              </select>
            </label>
          </div>
        </section>
      )}
    </div>
  );
}
