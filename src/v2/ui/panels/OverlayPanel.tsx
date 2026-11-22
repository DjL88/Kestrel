import React, { useState } from 'react';
import type {
  FeatureKey,
  FontOption,
  OverlayAnchor,
  OverlaySettings,
  OverlayTextRow,
  Photo,
  WatermarkPreset,
} from '../contract';
import { STRINGS } from '../strings';
import ProBadge from '../shell/ProBadge';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { detectOverlayOverflow, getActiveGroup } from '../utils/studioMath';

interface OverlayPanelProps {
  photo: Photo | null;
  fonts: FontOption[];
  watermarkPresets: WatermarkPreset[];
  features: Record<FeatureKey, boolean>;
  onUpdateOverlay: (photoId: string, patch: Partial<OverlaySettings>) => void;
  onAlignOverlaysCleanly: (photoId: string, layout: 'stacked-left' | 'opposite-bottom' | 'centred-pair') => void;
  onAddRow: (photoId: string) => void;
  onUpdateRow: (photoId: string, rowId: string, patch: Partial<OverlayTextRow>) => void;
  onRemoveRow: (photoId: string, rowId: string) => void;
  onAddCustomFont: (fontName: string) => void;
}

const ANCHORS: Array<{ id: OverlayAnchor; x: number; y: number }> = [
  { id: 'top-left', x: 8, y: 10 },
  { id: 'top-center', x: 50, y: 10 },
  { id: 'top-right', x: 92, y: 10 },
  { id: 'middle-left', x: 8, y: 50 },
  { id: 'middle-center', x: 50, y: 50 },
  { id: 'middle-right', x: 92, y: 50 },
  { id: 'bottom-left', x: 8, y: 90 },
  { id: 'bottom-center', x: 50, y: 90 },
  { id: 'bottom-right', x: 92, y: 90 },
];

const FIELD_CHOICES: Array<{ id: OverlayTextRow['fields'][number]; label: string }> = [
  { id: 'camera', label: 'Camera' },
  { id: 'lens', label: 'Lens' },
  { id: 'aperture', label: 'Aperture' },
  { id: 'shutter', label: 'Shutter' },
  { id: 'iso', label: 'ISO' },
  { id: 'focalLength', label: 'Focal' },
  { id: 'species', label: 'Subject' },
  { id: 'custom', label: 'Custom' },
];

export default function OverlayPanel({
  photo,
  fonts,
  watermarkPresets,
  features,
  onUpdateOverlay,
  onAlignOverlaysCleanly,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
  onAddCustomFont,
}: OverlayPanelProps) {
  const [subTab, setSubTab] = useState<'text' | 'watermark'>('text');
  const [openFontRowId, setOpenFontRowId] = useState<string | null>(null);
  const [fontQuery, setFontQuery] = useState('');
  const [customFontInput, setCustomFontInput] = useState('');

  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to edit overlays.</p>;
  }

  const group = getActiveGroup(photo);
  const overlay = group.overlay;
  const overflowIssues = detectOverlayOverflow(overlay, photo, photo.sizes);

  const filteredFonts = fonts.filter((f) =>
    `${f.label} ${f.category}`.toLowerCase().includes(fontQuery.trim().toLowerCase())
  );

  const toggleField = (row: OverlayTextRow, field: OverlayTextRow['fields'][number]) => {
    const exists = row.fields.includes(field);
    const next = exists ? row.fields.filter((f) => f !== field) : [...row.fields, field];
    onUpdateRow(photo.id, row.id, { fields: next });
  };

  return (
    <div className="space-y-4">
      {/* Text / Watermark Sub-tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
        <button
          type="button"
          onClick={() => setSubTab('text')}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'text'
              ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <BrandIcon name="text" size={14} />
          <span>{STRINGS.overlays.tabText}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('watermark')}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'watermark'
              ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <BrandIcon name="watermark" size={14} />
          <span>{STRINGS.overlays.tabWatermark}</span>
        </button>
      </div>

      {/* Suggested-Snapping & Clean Alignment Bar (applies to both Text & Watermark) */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Suggested snapping
            </span>
            <InfoPopover
              title="Suggested Snapping"
              body="Dragging Text or Watermark on the canvas magnetically snaps edges, baselines, and balanced spacing relative to each other and safe margins."
            />
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={overlay.snapEnabled}
            onClick={() => onUpdateOverlay(photo.id, { snapEnabled: !overlay.snapEnabled })}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              overlay.snapEnabled
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
            }`}
          >
            {overlay.snapEnabled ? 'Snap On' : 'Snap Off'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => onAlignOverlaysCleanly(photo.id, 'opposite-bottom')}
            className="rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:border-[var(--brand-accent)] hover:text-[var(--text-primary)]"
          >
            Opposite corners
          </button>
          <button
            type="button"
            onClick={() => onAlignOverlaysCleanly(photo.id, 'stacked-left')}
            className="rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:border-[var(--brand-accent)] hover:text-[var(--text-primary)]"
          >
            Stacked left
          </button>
          <button
            type="button"
            onClick={() => onAlignOverlaysCleanly(photo.id, 'centred-pair')}
            className="rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:border-[var(--brand-accent)] hover:text-[var(--text-primary)]"
          >
            Centred pair
          </button>
        </div>
      </div>

      {/* TEXT TAB */}
      {subTab === 'text' && (
        <div className="space-y-4">
          {!features.overlayText ? (
            <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><ProBadge feature="overlayText" />{STRINGS.pro.lockedHint}</p>
          ) : (
            <>
              {/* Enable toggle + Layout mode */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-primary)]">
                  Show text overlay on this photo
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={overlay.textEnabled}
                  onClick={() => onUpdateOverlay(photo.id, { textEnabled: !overlay.textEnabled })}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                    overlay.textEnabled
                      ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                      : 'bg-[var(--bg-input)] text-[var(--text-muted)]'
                  }`}
                >
                  {overlay.textEnabled ? 'Visible' : 'Off'}
                </button>
              </div>

              {/* Overflow issue flag */}
              {overflowIssues.length > 0 && (
                <div
                  role="alert"
                  className="rounded-[var(--radius-md)] border border-[var(--semantic-danger)]/40 bg-[var(--semantic-danger-soft)] p-2.5 text-xs text-[var(--semantic-danger)]"
                >
                  <p className="flex items-center gap-1.5 font-semibold">
                    <BrandIcon name="alert" size={14} />
                    <span>{STRINGS.overlays.overflowBannerTitle}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--text-primary)]">
                    {STRINGS.overlays.overflowBannerBody}{' '}
                    <strong>{overflowIssues.map((i) => i.sizeLabel).join(', ')}</strong>. Reduce font size or split into another row.
                  </p>
                </div>
              )}

              {/* Coverage Mode: As-is vs Cover full photo */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  {STRINGS.overlays.layoutModeLabel}
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateOverlay(photo.id, { textLayoutMode: 'as-is' })}
                    className={`h-8 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors ${
                      overlay.textLayoutMode === 'as-is'
                        ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {STRINGS.overlays.layoutAsIs}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateOverlay(photo.id, { textLayoutMode: 'cover-full' })}
                    className={`h-8 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors ${
                      overlay.textLayoutMode === 'cover-full'
                        ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {STRINGS.overlays.layoutFullPhoto}
                  </button>
                </div>
              </div>

              {/* Multi-row builder with font style preview dropdown */}
              <div className="space-y-2.5 border-t border-[var(--border-subtle)] pt-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.overlays.rowsHeading}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onAddRow(photo.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-accent)] hover:underline"
                  >
                    <BrandIcon name="plus" size={12} />
                    <span>{STRINGS.overlays.addRow}</span>
                  </button>
                </div>

                {overlay.rows.map((row, idx) => {
                  const activeFont = fonts.find((f) => f.id === row.fontId) ?? fonts[0];
                  const isDropdownOpen = openFontRowId === row.id;

                  return (
                    <div
                      key={row.id}
                      className="space-y-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                          Row {idx + 1}
                        </span>
                        {overlay.rows.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove Row ${idx + 1}`}
                            onClick={() => onRemoveRow(photo.id, row.id)}
                            className="text-[var(--text-muted)] hover:text-[var(--semantic-danger)]"
                          >
                            <BrandIcon name="trash" size={13} />
                          </button>
                        )}
                      </div>

                      {/* Data field toggles */}
                      <div className="flex flex-wrap gap-1">
                        {FIELD_CHOICES.map((fc) => {
                          const on = row.fields.includes(fc.id);
                          return (
                            <button
                              key={fc.id}
                              type="button"
                              onClick={() => toggleField(row, fc.id)}
                              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                on
                                  ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {fc.label}
                            </button>
                          );
                        })}
                      </div>

                      {row.fields.includes('custom') && (
                        <input
                          type="text"
                          value={row.customText}
                          onChange={(e) => onUpdateRow(photo.id, row.id, { customText: e.target.value })}
                          placeholder="Custom line text…"
                          className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
                        />
                      )}

                      {/* Styled Font Dropdown (shows each font in its own typeface!) */}
                      <div className="relative">
                        <button
                          type="button"
                          aria-expanded={isDropdownOpen}
                          onClick={() => setOpenFontRowId(isDropdownOpen ? null : row.id)}
                          className="flex h-8 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 text-xs text-[var(--text-primary)]"
                        >
                          <span style={{ fontFamily: activeFont.family }} className="truncate">
                            {activeFont.label}
                          </span>
                          <BrandIcon name="chevron" size={13} className="text-[var(--text-muted)]" />
                        </button>

                        {isDropdownOpen && (
                          <div className="mt-1.5 max-h-56 overflow-y-auto inflight-scroll rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-2 shadow-[var(--shadow-popover)]">
                            <input
                              type="search"
                              value={fontQuery}
                              onChange={(e) => setFontQuery(e.target.value)}
                              placeholder={STRINGS.overlays.fontSearchPlaceholder}
                              className="mb-2 h-7 w-full rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-primary)]"
                            />
                            <div className="space-y-0.5">
                              {filteredFonts.map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => {
                                    onUpdateRow(photo.id, row.id, { fontId: f.id });
                                    setOpenFontRowId(null);
                                  }}
                                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                                    f.id === row.fontId
                                      ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                                  }`}
                                >
                                  <span style={{ fontFamily: f.family }} className="text-sm">
                                    {f.label}
                                  </span>
                                  <span className="text-[10px] text-[var(--text-muted)]">{f.category}</span>
                                </button>
                              ))}
                            </div>

                            {/* Add custom / device-installed font */}
                            <div className="mt-2 flex gap-1 border-t border-[var(--border-subtle)] pt-2">
                              <input
                                type="text"
                                value={customFontInput}
                                onChange={(e) => setCustomFontInput(e.target.value)}
                                placeholder="Device or custom font name…"
                                className="h-7 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-primary)]"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!customFontInput.trim()) return;
                                  onAddCustomFont(customFontInput);
                                  setCustomFontInput('');
                                }}
                                className="h-7 rounded bg-[var(--brand-accent)] px-2 text-[11px] font-semibold text-[var(--text-on-accent)]"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Size & Uppercase */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                            <span>Size</span>
                            <span className="font-mono tabular-nums">{row.sizePx}px</span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={42}
                            value={row.sizePx}
                            onChange={(e) => onUpdateRow(photo.id, row.id, { sizePx: Number(e.target.value) })}
                            className="inflight-slider"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => onUpdateRow(photo.id, row.id, { uppercase: !row.uppercase })}
                          className={`h-7 rounded border px-2 text-[10px] font-semibold ${
                            row.uppercase
                              ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]'
                          }`}
                        >
                          AA
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Per-image Position 9-point grid */}
              {overlay.textLayoutMode === 'as-is' && (
                <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.overlays.positionHeading}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ANCHORS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        aria-label={`Place text at ${a.id}`}
                        onClick={() =>
                          onUpdateOverlay(photo.id, {
                            textPosition: a.id,
                            textX: a.x,
                            textY: a.y,
                          })
                        }
                        className={`h-7 rounded-[var(--radius-xs)] border text-[10px] font-medium capitalize transition-colors ${
                          overlay.textPosition === a.id
                            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {a.id.replace('-', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* WATERMARK TAB */}
      {subTab === 'watermark' && (
        <div className="space-y-4">
          {!features.watermarkCustom ? (
            <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><ProBadge feature="watermarkCustom" />{STRINGS.pro.lockedHint}</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {STRINGS.overlays.watermarkEnable}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={overlay.watermarkEnabled}
                  onClick={() =>
                    onUpdateOverlay(photo.id, { watermarkEnabled: !overlay.watermarkEnabled })
                  }
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                    overlay.watermarkEnabled
                      ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                      : 'bg-[var(--bg-input)] text-[var(--text-muted)]'
                  }`}
                >
                  {overlay.watermarkEnabled ? 'Visible' : 'Off'}
                </button>
              </div>

              {/* Watermark library */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <BrandIcon name="watermark-library" size={14} />
                  <span>{STRINGS.overlays.watermarkLibrary}</span>
                </span>
                <div className="space-y-1.5">
                  {watermarkPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onUpdateOverlay(photo.id, {
                          watermarkEnabled: true,
                          watermarkPresetId: preset.id,
                        })
                      }
                      className={`flex w-full flex-col rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-colors ${
                        overlay.watermarkPresetId === preset.id
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {preset.label}
                      </span>
                      <span className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                        {preset.text} {preset.subtext ? `· ${preset.subtext}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Contrast swatch */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateOverlay(photo.id, { watermarkContrast: 'light-on-dark' })}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-xs font-medium ${
                    overlay.watermarkContrast === 'light-on-dark'
                      ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                  }`}
                >
                  <BrandIcon name="swatch-light-on-dark" size={14} />
                  <span>{STRINGS.overlays.lightOnDark}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateOverlay(photo.id, { watermarkContrast: 'dark-on-light' })}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-xs font-medium ${
                    overlay.watermarkContrast === 'dark-on-light'
                      ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                  }`}
                >
                  <BrandIcon name="swatch-dark-on-light" size={14} />
                  <span>{STRINGS.overlays.darkOnLight}</span>
                </button>
              </div>

              {/* Opacity & Scale */}
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>{STRINGS.overlays.watermarkOpacity}</span>
                    <span className="font-mono tabular-nums">{overlay.watermarkOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={100}
                    value={overlay.watermarkOpacity}
                    onChange={(e) => onUpdateOverlay(photo.id, { watermarkOpacity: Number(e.target.value) })}
                    className="inflight-slider"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>{STRINGS.overlays.watermarkScale}</span>
                    <span className="font-mono tabular-nums">{overlay.watermarkScale}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={150}
                    value={overlay.watermarkScale}
                    onChange={(e) => onUpdateOverlay(photo.id, { watermarkScale: Number(e.target.value) })}
                    className="inflight-slider"
                  />
                </div>
              </div>

              {/* Per-image Watermark 9-point grid */}
              <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {STRINGS.overlays.positionHeading}
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {ANCHORS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-label={`Place watermark at ${a.id}`}
                      onClick={() =>
                        onUpdateOverlay(photo.id, {
                          watermarkEnabled: true,
                          watermarkPosition: a.id,
                          watermarkX: a.x,
                          watermarkY: a.y,
                        })
                      }
                      className={`h-7 rounded-[var(--radius-xs)] border text-[10px] font-medium capitalize transition-colors ${
                        overlay.watermarkPosition === a.id
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {a.id.replace('-', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
