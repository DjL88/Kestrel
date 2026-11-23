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
import ProBadge, { useProHidden } from '../shell/ProBadge';
import FontPicker from './FontPicker';
import WatermarkLibrary from './WatermarkLibrary';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { detectOverlayOverflow, fitOverlayRows, formatOverlayRowText, getActiveGroup } from '../utils/studioMath';

/** The words a row will say on this photo (or a pangram when it has nothing yet), so a font is judged on real text. */
const sampleText = (photo: Photo, row: OverlayTextRow) => formatOverlayRowText(row, photo).trim() || 'The quick brown fox jumps over the lazy dog';

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
  onListDeviceFonts: () => Promise<string[] | null>;
  onImportWatermark: () => Promise<string | null>;
  onCutOutWatermark: (presetId: string, slot: 'dark' | 'light', tolerance: number, commit: boolean) => Promise<{ url: string; tooMuch: boolean } | null>;
  onMakeWatermarkVariant: (presetId: string, slot: 'dark' | 'light') => Promise<void>;
  onDeleteWatermark: (presetId: string) => void;
  onHasDeviceFont: (fontName: string) => boolean;
  templates: Array<{ id: string; name: string }>;
  selectedPhotoIds: string[];
  onSaveTemplate: (photoId: string, name: string) => void;
  onApplyTemplate: (templateId: string, photoIds: string[]) => void;
  onRenameTemplate: (templateId: string, name: string) => void;
  onDeleteTemplate: (templateId: string) => void;
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

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`inline-flex items-center gap-2 rounded-full border px-1 py-1 pr-2.5 text-[11px] font-semibold transition-colors ${
        on ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]' : 'border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
      }`}
    >
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-[var(--brand-accent)]' : 'bg-[var(--bg-surface-active)]'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {on ? STRINGS.overlays.on : STRINGS.overlays.off}
    </button>
  );
}

export default function OverlayPanel({
  templates,
  selectedPhotoIds,
  onSaveTemplate,
  onApplyTemplate,
  onRenameTemplate,
  onDeleteTemplate,
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
  onListDeviceFonts,
  onHasDeviceFont,
  onImportWatermark,
  onCutOutWatermark,
  onMakeWatermarkVariant,
  onDeleteWatermark,
}: OverlayPanelProps) {
  const hideTextTab = useProHidden('overlayText');
  const hideMarkTab = useProHidden('watermarkCustom');
  const [templateName, setTemplateName] = useState('');
  const [subTab, setSubTab] = useState<'text' | 'watermark'>('text');

  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to edit overlays.</p>;
  }

  const group = getActiveGroup(photo);
  const overlay = group.overlay;
  const overflowIssues = detectOverlayOverflow(overlay, photo, photo.sizes);
  const [overflowOpen, setOverflowOpen] = React.useState(false);


  const toggleField = (row: OverlayTextRow, field: OverlayTextRow['fields'][number]) => {
    const exists = row.fields.includes(field);
    const next = exists ? row.fields.filter((f) => f !== field) : [...row.fields, field];
    onUpdateRow(photo.id, row.id, { fields: next });
  };

  // A tab the person asked not to see (a locked Pro one) is taken out, not greyed; the other opens in its place.
  const textTabGone = hideTextTab && !features.overlayText;
  const markTabGone = hideMarkTab && !features.watermarkCustom;
  const activeSub: 'text' | 'watermark' = textTabGone ? 'watermark' : markTabGone ? 'text' : subTab;
  const targets = selectedPhotoIds.length > 0 ? selectedPhotoIds : [photo.id];

  return (
    <div className="space-y-4">
      <section aria-labelledby="overlay-templates-title" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
        <h3 id="overlay-templates-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.overlays.templatesHeading}</h3>
        <p className="text-[11px] leading-snug text-[var(--text-muted)]">{STRINGS.overlays.templatesIntro}</p>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => { e.preventDefault(); onSaveTemplate(photo.id, templateName); setTemplateName(''); }}
        >
          <label htmlFor="overlay-template-name" className="sr-only">{STRINGS.overlays.templateNameLabel}</label>
          <input id="overlay-template-name" type="text" maxLength={40} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={STRINGS.overlays.templateNameLabel}
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-primary)]" />
          <button type="submit" className="min-h-10 shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-[11px] font-semibold text-[var(--text-on-accent)]">{STRINGS.overlays.templateSave}</button>
        </form>
        {templates.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.overlays.templatesNone}</p>
        ) : (
          <ul aria-label={STRINGS.overlays.templatesHeading} className="space-y-1.5">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-1.5">
                <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-[var(--text-primary)]">{template.name}</span>
                <button type="button" aria-label={`${STRINGS.overlays.templateApply(targets.length)}: ${template.name}`} onClick={() => onApplyTemplate(template.id, targets)}
                  className="min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[11px] font-medium text-[var(--text-primary)]">{STRINGS.overlays.templateApply(targets.length)}</button>
                <button type="button" aria-label={`${STRINGS.overlays.templateRename} ${template.name}`} onClick={() => { const next = window.prompt(STRINGS.overlays.templateNameLabel, template.name); if (next !== null) onRenameTemplate(template.id, next); }}
                  className="min-h-9 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{STRINGS.overlays.templateRename}</button>
                <button type="button" aria-label={`${STRINGS.overlays.templateDelete} ${template.name}`} onClick={() => onDeleteTemplate(template.id)}
                  className="min-h-9 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--status-danger,#e5484d)]">{STRINGS.overlays.templateDelete}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Text / Watermark Sub-tabs */}
      <div className={`grid gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5 ${textTabGone || markTabGone ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {!textTabGone && (
        <button
          type="button"
          onClick={() => setSubTab('text')}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
            activeSub === 'text'
              ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <BrandIcon name="text" size={14} />
          <span>{STRINGS.overlays.tabText}</span>
        </button>
        )}
        {!markTabGone && (
        <button
          type="button"
          onClick={() => setSubTab('watermark')}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
            activeSub === 'watermark'
              ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <BrandIcon name="watermark" size={14} />
          <span>{STRINGS.overlays.tabWatermark}</span>
        </button>
        )}
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
      {activeSub === 'text' && (
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
                <Switch on={overlay.textEnabled} label={STRINGS.overlays.textToggleLabel} onToggle={() => onUpdateOverlay(photo.id, { textEnabled: !overlay.textEnabled })} />
              </div>

              {/* Text too wide: opens to say which row and offers a one-click fix */}
              {overflowIssues.length > 0 && (
                <div className="rounded-[var(--radius-md)] border border-[var(--semantic-warning)] bg-[var(--semantic-warning-soft)] text-xs text-[var(--text-primary)]">
                  <button
                    type="button"
                    aria-expanded={overflowOpen}
                    onClick={() => setOverflowOpen((value) => !value)}
                    className="flex w-full items-center justify-between gap-2 p-2.5 text-left font-semibold"
                  >
                    <span className="flex items-center gap-1.5"><BrandIcon name="alert" size={14} />{STRINGS.overlays.overflowShort}</span>
                    <BrandIcon name={overflowOpen ? 'chevron-up' : 'chevron-down'} size={13} />
                  </button>
                  {overflowOpen && (
                    <div role="status" className="space-y-2 border-t border-[var(--semantic-warning)]/40 p-2.5 text-[11px] leading-snug">
                      <p>{STRINGS.overlays.overflowWhy}</p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {overflowIssues.map((issue) => <li key={issue.sizeId}><strong>{issue.sizeLabel}</strong>: {issue.reason}</li>)}
                      </ul>
                      <button
                        type="button"
                        onClick={() => onUpdateOverlay(photo.id, { rows: fitOverlayRows(overlay, photo), textOffsetX: 0 })}
                        className="rounded-[var(--radius-xs)] bg-[var(--brand-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-on-accent)]"
                      >
                        {STRINGS.overlays.overflowFit}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div inert={!overlay.textEnabled ? true : undefined} aria-disabled={!overlay.textEnabled} className={`space-y-4 transition-opacity ${overlay.textEnabled ? '' : 'pointer-events-none opacity-40'}`}>
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

                      <FontPicker
                        fonts={fonts}
                        row={row}
                        sample={sampleText(photo, row)}
                        onSelect={(fontId) => onUpdateRow(photo.id, row.id, { fontId })}
                        onAddCustomFont={onAddCustomFont}
                        onListDeviceFonts={onListDeviceFonts}
                        onHasDeviceFont={onHasDeviceFont}
                      />

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
                  <div role="group" aria-label={STRINGS.overlays.positionHeading} className="mx-auto grid w-24 grid-cols-3 gap-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-1">
                    {ANCHORS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        aria-label={`Place text at ${a.id}`}
                        aria-pressed={overlay.textPosition === a.id}
                        onClick={() => onUpdateOverlay(photo.id, { textPosition: a.id, textX: a.x, textY: a.y })}
                        className="grid h-8 place-items-center"
                      >
                        <span className={`block rounded-full transition-all ${overlay.textPosition === a.id ? 'h-3.5 w-3.5 bg-[var(--brand-accent)] ring-2 ring-[var(--brand-accent-border)]' : 'h-2 w-2 bg-[var(--text-muted)] hover:bg-[var(--text-primary)]'}`} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </>
          )}
        </div>
      )}

      {/* WATERMARK TAB */}
      {activeSub === 'watermark' && (
        <div className="space-y-4">
          {!features.watermarkCustom ? (
            <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><ProBadge feature="watermarkCustom" />{STRINGS.pro.lockedHint}</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {STRINGS.overlays.watermarkEnable}
                </span>
                <Switch on={overlay.watermarkEnabled} label={STRINGS.overlays.watermarkToggleLabel} onToggle={() => onUpdateOverlay(photo.id, { watermarkEnabled: !overlay.watermarkEnabled })} />
              </div>

              {/* Watermark library */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <BrandIcon name="watermark-library" size={14} />
                  <span>{STRINGS.overlays.watermarkLibrary}</span>
                </span>
                <WatermarkLibrary
                  presets={watermarkPresets}
                  selectedId={overlay.watermarkPresetId}
                  onSelect={(presetId) => onUpdateOverlay(photo.id, { watermarkEnabled: true, watermarkPresetId: presetId })}
                  onImport={onImportWatermark}
                  onCutOut={onCutOutWatermark}
                  onMakeVariant={onMakeWatermarkVariant}
                  onDelete={onDeleteWatermark}
                />
              </div>

              <div inert={!overlay.watermarkEnabled ? true : undefined} aria-disabled={!overlay.watermarkEnabled} className={`space-y-4 transition-opacity ${overlay.watermarkEnabled ? '' : 'pointer-events-none opacity-40'}`}>
              {/* Contrast swatch */}
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  aria-pressed={overlay.watermarkContrast === 'auto'}
                  onClick={() => onUpdateOverlay(photo.id, { watermarkContrast: 'auto' })}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-xs font-medium ${
                    overlay.watermarkContrast === 'auto'
                      ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                  }`}
                >
                  <span>{STRINGS.watermarks.auto}</span>
                </button>
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
                <div role="group" aria-label="Watermark position" className="mx-auto grid w-24 grid-cols-3 gap-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-1">
                  {ANCHORS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-label={`Place watermark at ${a.id}`}
                      aria-pressed={overlay.watermarkPosition === a.id}
                      onClick={() => onUpdateOverlay(photo.id, { watermarkPosition: a.id, watermarkX: a.x, watermarkY: a.y })}
                      className="grid h-8 place-items-center"
                    >
                      <span className={`block rounded-full transition-all ${overlay.watermarkPosition === a.id ? 'h-3.5 w-3.5 bg-[var(--brand-accent)] ring-2 ring-[var(--brand-accent-border)]' : 'h-2 w-2 bg-[var(--text-muted)] hover:bg-[var(--text-primary)]'}`} />
                    </button>
                  ))}
                </div>
              </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
