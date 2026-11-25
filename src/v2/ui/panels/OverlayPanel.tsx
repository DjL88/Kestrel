import React, { useState } from 'react';
import type {
  FeatureKey,
  FontOption,
  OverlayAnchor,
  OverlaySettings,
  OverlayStack,
  OverlayTextRow,
  Photo,
  WatermarkPreset,
} from '../contract';
import { STRINGS } from '../strings';
import ProBadge, { useProHidden } from '../shell/ProBadge';
import WatermarkLibrary from './WatermarkLibrary';
import WatermarkSetup from './WatermarkSetup';
import OverlayTextRows from './OverlayTextRows';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { detectOverlayOverflow, fitOverlayRows, getActiveGroup } from '../utils/studioMath';
import { ANCHORS, alignForAnchor, anchorCentre } from '../utils/overlayLayout';

interface OverlayPanelProps {
  photo: Photo | null;
  fonts: FontOption[];
  watermarkPresets: WatermarkPreset[];
  features: Record<FeatureKey, boolean>;
  onUpdateOverlay: (photoId: string, patch: Partial<OverlaySettings>) => void;
  onAlignOverlaysCleanly: (photoId: string, layout: OverlayStack) => void;
  onAddRow: (photoId: string) => void;
  onUpdateRow: (photoId: string, rowId: string, patch: Partial<OverlayTextRow>) => void;
  onRemoveRow: (photoId: string, rowId: string) => void;
  onMoveRow: (photoId: string, rowId: string, direction: -1 | 1) => void;
  onAddTextWatermark: (text: string, subtext: string) => string | null;
  onAddWatermarkVersion: (presetId: string, slot: 'dark' | 'light') => Promise<boolean>;
  onSetWatermarkSlot: (presetId: string, slot: 'dark' | 'light') => void;
  onAddCustomFont: (fontName: string) => void;
  onListDeviceFonts: () => Promise<string[] | null>;
  onImportWatermark: (usage: import('../contract').WatermarkUsage) => Promise<string | null>;
  onCutOutWatermark: (presetId: string, slot: 'dark' | 'light', tolerance: number, commit: boolean) => Promise<{ url: string; tooMuch: boolean } | null>;
  onMakeWatermarkVariant: (presetId: string, slot: 'dark' | 'light') => Promise<void>;
  onDeleteWatermark: (presetId: string) => void;
  onHasDeviceFont: (fontName: string) => boolean;
  templates: Array<{ id: string; name: string }>;
  selectedPhotoIds: string[];
  onSaveTemplate: (photoId: string, name: string) => void;
  onApplyTemplate: (templateId: string, photoIds: string[]) => void;
  onManageTemplates: () => void;
}

/** The patch that puts one box at a place on the grid: anchored there (its edge at the margin), the text lined up with that side. */
const anchorPatch = (which: 'text' | 'watermark', position: OverlayAnchor): Partial<OverlaySettings> => {
  const centre = anchorCentre(position);
  return which === 'text'
    ? { textPosition: position, textPlacement: 'anchor', textAlign: alignForAnchor(position), textX: centre.x, textY: centre.y }
    : { watermarkPosition: position, watermarkPlacement: 'anchor', watermarkX: centre.x, watermarkY: centre.y };
};

const ANCHOR_WORDS: Record<OverlayAnchor, string> = {
  'top-left': 'top-left', 'top-center': 'top-center', 'top-right': 'top-right',
  'middle-left': 'middle-left', 'middle-center': 'middle-center', 'middle-right': 'middle-right',
  'bottom-left': 'bottom-left', 'bottom-center': 'bottom-center', 'bottom-right': 'bottom-right',
};

const segment = (on: boolean) => `min-h-8 rounded-[var(--radius-xs)] border px-1.5 text-[11px] font-medium transition-colors ${
  on ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--brand-accent)] hover:text-[var(--text-primary)]'}`;

/** The nine places a box can be anchored to. None is marked while the box sits where it was dragged. */
function PositionGrid({ label, active, onPick, place }: { label: string; active: OverlayAnchor | null; onPick: (anchor: OverlayAnchor) => void; place: (anchor: string) => string }) {
  return (
    <div role="group" aria-label={label} className="mx-auto grid w-24 grid-cols-3 gap-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-1">
      {ANCHORS.map((anchor) => (
        <button key={anchor} type="button" aria-label={place(ANCHOR_WORDS[anchor])} aria-pressed={active === anchor} onClick={() => onPick(anchor)} className="grid h-8 place-items-center">
          <span className={`block rounded-full transition-all ${active === anchor ? 'h-3.5 w-3.5 bg-[var(--brand-accent)] ring-2 ring-[var(--brand-accent-border)]' : 'h-2 w-2 bg-[var(--text-muted)] hover:bg-[var(--text-primary)]'}`} />
        </button>
      ))}
    </div>
  );
}

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
  onManageTemplates,
  photo,
  fonts,
  watermarkPresets,
  features,
  onUpdateOverlay,
  onAlignOverlaysCleanly,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
  onMoveRow,
  onAddTextWatermark,
  onAddWatermarkVersion,
  onSetWatermarkSlot,
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
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  const [settingUpMark, setSettingUpMark] = useState(false);

  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToOverlay}</p>;
  }

  const group = getActiveGroup(photo);
  const overlay = group.overlay;
  const overflowIssues = detectOverlayOverflow(overlay, photo, photo.sizes);


  // A tab the person asked not to see (a locked Pro one) is taken out, not greyed; the other opens in its place.
  const textTabGone = hideTextTab && !features.overlayText;
  const markTabGone = hideMarkTab && !features.watermarkCustom;
  const activeSub: 'text' | 'watermark' = textTabGone ? 'watermark' : markTabGone ? 'text' : subTab;
  const targets = selectedPhotoIds.length > 0 ? selectedPhotoIds : [photo.id];

  return (
    <div className="space-y-4">

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
              {STRINGS.panelWords.suggestedSnapping}
            </span>
            <InfoPopover
              title={STRINGS.panelWords.suggestedSnapping}
              body={STRINGS.panelWords.snappingHelp}
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
            {overlay.snapEnabled ? STRINGS.panelWords.snapOn : STRINGS.panelWords.snapOff}
          </button>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--text-secondary)]">{STRINGS.overlayKit.stackHeading}</p>
          <div role="group" aria-label={STRINGS.overlayKit.stackHeading} className="grid grid-cols-3 gap-1">
            {([
              ['left', STRINGS.overlayKit.left],
              ['center', STRINGS.overlayKit.centre],
              ['right', STRINGS.overlayKit.right],
            ] as const).map(([layout, label]) => {
              const on = overlay.textPlacement === 'anchor' && overlay.watermarkPlacement === 'anchor' && overlay.textPosition === `bottom-${layout}` && overlay.watermarkPosition === `bottom-${layout}`;
              return (
                <button key={layout} type="button" aria-pressed={on} onClick={() => onAlignOverlaysCleanly(photo.id, layout)} className={segment(on)}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] leading-snug text-[var(--text-muted)]">{STRINGS.overlayKit.stackHelp}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">{STRINGS.overlayKit.marginLabel}<InfoPopover title={STRINGS.overlayKit.marginLabel} body={STRINGS.overlayKit.marginHelp} /></span>
            <span className="font-mono tabular-nums">{overlay.edgeMargin}%</span>
          </div>
          <input type="range" min={0} max={12} step={0.5} value={overlay.edgeMargin} aria-label={STRINGS.overlayKit.marginLabel}
            onChange={(e) => onUpdateOverlay(photo.id, { edgeMargin: Number(e.target.value) })} className="inflight-slider" />
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
                  {STRINGS.panelWords.showTextOverlay}
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
                        onClick={() => onUpdateOverlay(photo.id, { rows: fitOverlayRows({ ...overlay, textOffsetX: 0, textOffsetY: 0 }, photo), textOffsetX: 0, textOffsetY: 0 })}
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

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <OverlayTextRows
                  rows={overlay.rows}
                  photo={photo}
                  overlay={overlay}
                  fonts={fonts}
                  onAddRow={() => onAddRow(photo.id)}
                  onUpdateRow={(rowId, patch) => onUpdateRow(photo.id, rowId, patch)}
                  onRemoveRow={(rowId) => onRemoveRow(photo.id, rowId)}
                  onMoveRow={(rowId, direction) => onMoveRow(photo.id, rowId, direction)}
                  onAddCustomFont={onAddCustomFont}
                  onListDeviceFonts={onListDeviceFonts}
                  onHasDeviceFont={onHasDeviceFont}
                />
              </div>

              {/* Per-image place on the 9-point grid, and how the rows line up */}
              {overlay.textLayoutMode === 'as-is' && (
                <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.overlays.positionHeading}</span>
                  <PositionGrid label={STRINGS.overlays.positionHeading} active={overlay.textPlacement === 'anchor' ? overlay.textPosition : null}
                    onPick={(anchor) => onUpdateOverlay(photo.id, anchorPatch('text', anchor))} place={(where) => `Place text at ${where}`} />
                  {overlay.textPlacement === 'free' && <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.overlayKit.placedByDrag}</p>}
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-[var(--text-secondary)]">{STRINGS.overlayKit.alignLabel}</p>
                    <div role="group" aria-label={STRINGS.overlayKit.alignLabel} className="grid grid-cols-3 gap-1">
                      {([['left', STRINGS.overlayKit.left], ['center', STRINGS.overlayKit.centre], ['right', STRINGS.overlayKit.right]] as const).map(([align, label]) => (
                        <button key={align} type="button" aria-pressed={overlay.textAlign === align} onClick={() => onUpdateOverlay(photo.id, { textAlign: align })} className={segment(overlay.textAlign === align)}>{label}</button>
                      ))}
                    </div>
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

              {/* The person's own watermarks, and the guided flow that adds one */}
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <BrandIcon name="watermark-library" size={14} />
                  <span>{STRINGS.overlayKit.wmYours}</span>
                </span>
                {watermarkPresets.length === 0 && !settingUpMark && <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.overlayKit.wmNone}</p>}
                {watermarkPresets.length > 0 && (
                  <WatermarkLibrary
                    presets={watermarkPresets}
                    selectedId={watermarkPresets.some((preset) => preset.id === overlay.watermarkPresetId) ? overlay.watermarkPresetId : watermarkPresets[0].id}
                    onSelect={(presetId) => onUpdateOverlay(photo.id, { watermarkEnabled: true, watermarkPresetId: presetId })}
                    onAddVersion={onAddWatermarkVersion}
                    onSetSlot={onSetWatermarkSlot}
                    onCutOut={onCutOutWatermark}
                    onMakeVariant={onMakeWatermarkVariant}
                    onDelete={onDeleteWatermark}
                  />
                )}
                {settingUpMark ? (
                  <WatermarkSetup
                    onImport={onImportWatermark}
                    onAddText={onAddTextWatermark}
                    onAddVersion={onAddWatermarkVersion}
                    onMakeVariant={onMakeWatermarkVariant}
                    onCutOut={onCutOutWatermark}
                    onCreated={(presetId) => onUpdateOverlay(photo.id, { watermarkEnabled: true, watermarkPresetId: presetId })}
                    onClose={() => setSettingUpMark(false)}
                  />
                ) : (
                  <button type="button" onClick={() => setSettingUpMark(true)}
                    className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] text-xs font-semibold text-[var(--brand-accent)] hover:bg-[var(--bg-surface-hover)]">
                    <BrandIcon name="plus" size={13} />{STRINGS.overlayKit.wmAdd}
                  </button>
                )}
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
                <span className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.overlays.positionHeading}</span>
                <PositionGrid label={STRINGS.panelWords.watermarkPosition} active={overlay.watermarkPlacement === 'anchor' ? overlay.watermarkPosition : null}
                  onPick={(anchor) => onUpdateOverlay(photo.id, anchorPatch('watermark', anchor))} place={(where) => `Place watermark at ${where}`} />
                {overlay.watermarkPlacement === 'free' && <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.overlayKit.placedByDrag}</p>}
              </div>
              </div>
            </>
          )}
        </div>
      )}
      {/* Templates are kept and managed in Settings → Templates. Here: apply one, or save this photo's overlay as one. */}
      <section aria-labelledby="overlay-templates-title" className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id="overlay-templates-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.overlays.templatesHeading}</h3>
          <button type="button" onClick={onManageTemplates} aria-label={`${STRINGS.settings.heading}: ${STRINGS.overlays.templatesHeading}`}
            className="min-h-9 rounded border border-[var(--border-default)] px-2 text-xs">{STRINGS.settings.heading}</button>
        </div>
        {templates.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.overlays.templatesNone}</p>
        ) : (
          <select aria-label={`${STRINGS.overlayKit.applyTemplateLabel}: ${STRINGS.overlays.templateApply(targets.length)}`} value=""
            className="min-h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
            onChange={(event) => { if (event.target.value) onApplyTemplate(event.target.value, targets); }}>
            <option value="" disabled>{STRINGS.overlayKit.applyTemplate}</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        )}
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); onSaveTemplate(photo.id, templateName); setTemplateName(''); }}>
          <label htmlFor="overlay-template-name" className="sr-only">{STRINGS.overlays.templateNameLabel}</label>
          <input id="overlay-template-name" type="text" maxLength={40} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={STRINGS.overlays.templateNameLabel}
            className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-primary)]" />
          <button type="submit" disabled={!templateName.trim()} className="min-h-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-[11px] font-semibold text-[var(--text-primary)] disabled:opacity-50">{STRINGS.overlays.templateSave}</button>
        </form>
      </section>
    </div>
  );
}
