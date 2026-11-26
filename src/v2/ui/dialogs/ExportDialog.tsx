import React, { useRef, useState } from 'react';
import { useDialogFocus } from '../utils/dialogFocus';
import { activeLanguage } from '../../../core/locale';
import { isRawPreviewFile } from '../../../core/rawFormats';
import { isDesktopApp, isMobileShell } from '../../../providers/desktopShell';
import { canDevelopRaw } from '../../../providers/rawDevelop';
import type {
  ExportDestination,
  ExportRequest,
  Photo,
  SocialPlatform,
} from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { SocialLogo, type BrandIconName } from '../icons/BrandIcon';
import {
  DEFAULT_EXPORT_SETTINGS, MAX_PRESET_NAME, deletePreset, exportTargetFor, readPresets, requestFromSettings, savePreset, settingsMatch,
  writeLastExport, writePresets, type ExportSettings, type SavedExportPreset,
} from '../../engineClient/exportSettings';
import BrandKitSection, { type BrandKitChoice } from './BrandKitSection';

const deviceStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try { return window.localStorage; } catch { return null; }
};

interface ExportDialogProps {
  open: boolean;
  photo: Photo | null;
  selectedPhotoIds: string[];
  onClose: () => void;
  onExport: (request: ExportRequest) => void;
  /** Brand kits (K080). Absent while the preview is off, and then the section is not shown. */
  brandKits?: BrandKitChoice[];
  onSaveBrandKit?: (photoId: string, name: string) => boolean;
  onEditBrandKit?: (kitId: string, change: { name?: string; fromPhotoId?: string }) => boolean;
  onDeleteBrandKit?: (kitId: string) => void;
}

const SOCIAL_PLATFORMS: Array<{ id: SocialPlatform; label: string; sizeIds: string[] }> = [
  { id: 'instagram', label: 'Instagram', sizeIds: ['ig-portrait', 'ig-square', 'ig-story'] },
  { id: 'youtube', label: 'YouTube', sizeIds: ['yt-wide', 'orig-3x2'] },
  { id: 'x', label: 'X', sizeIds: ['x-feed', 'orig-3x2'] },
  { id: 'linkedin', label: 'LinkedIn', sizeIds: ['x-feed', 'ig-square'] },
  { id: 'tiktok', label: 'TikTok', sizeIds: ['ig-story'] },
  { id: 'pinterest', label: 'Pinterest', sizeIds: ['ig-portrait'] },
];

export default function ExportDialog({
  open,
  photo,
  selectedPhotoIds,
  onClose,
  onExport,
  brandKits,
  onSaveBrandKit,
  onEditBrandKit,
  onDeleteBrandKit,
}: ExportDialogProps) {
  const d = DEFAULT_EXPORT_SETTINGS;
  const [fileFormat, setFileFormat] = useState<'jpeg' | 'png'>(d.fileFormat);
  const [jpegQuality, setJpegQuality] = useState(d.jpegQuality);
  const [maxSizeChoice, setMaxSizeChoice] = useState<ExportSettings['maxSize']>(d.maxSize);
  const [customMaxSize, setCustomMaxSize] = useState(d.customMaxSize);
  const [destination, setDestination] = useState<ExportDestination>(d.destination);
  const [chosenSizes, setChosenSizes] = useState<string[] | null>(d.sizeIds);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() => photo ? [photo.activeGroupId] : []);
  const [includeBefore, setIncludeBefore] = useState(d.includeBefore);
  const [includeAfter, setIncludeAfter] = useState(d.includeAfter);
  const [includeOriginal, setIncludeOriginal] = useState(d.includeOriginal);
  // Saved settings (G09): the same settings the wizard sends, under a name, on this device only.
  const [presets, setPresets] = useState<SavedExportPreset[]>(() => { const store = deviceStorage(); return store ? readPresets(store) : []; });
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetNote, setPresetNote] = useState('');
  const [brandKitId, setBrandKitId] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const onDialogKeyDown = useDialogFocus(open && !!photo, panelRef, onClose);

  if (!open || !photo) return null;
  // Export the formats the canvas shows: every switched-on photo format, each as it is framed and split there.
  const enabledFormats = photo.sizes.filter(size => size.kind === 'photo' && size.enabled);
  const selectedSizeIds = chosenSizes?.filter(id => enabledFormats.some(size => size.id === id))
    ?? enabledFormats.map(size => size.id);
  const frameCount = (sizeId: string) => {
    const split = photo.formatSplits?.[sizeId];
    return split?.enabled ? split.count ?? 2 : 1;
  };
  // Text and watermark are placed on the canvas, so the export carries exactly what is shown there.
  const activeOverlay = photo.editGroups.find((g) => g.id === photo.activeGroupId)?.overlay;
  const canvasOverlays = [
    activeOverlay?.textEnabled ? STRINGS.exportDialog.overlayText : '',
    activeOverlay?.watermarkEnabled ? STRINGS.exportDialog.overlayWatermark : '',
  ].filter(Boolean);
  const photoIds = selectedPhotoIds.length ? selectedPhotoIds : [photo.id];
  const canRequestRaw = photoIds.length === 1 && photoIds[0] === photo.id &&
    photo.originalConnected && isRawPreviewFile(photo.filename) && canDevelopRaw();

  const toggleSize = (id: string) => {
    setChosenSizes(selectedSizeIds.includes(id) ? selectedSizeIds.filter(item => item !== id) : [...selectedSizeIds, id]);
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((g) => g !== id) : prev) : [...prev, id]
    );
  };

  const selectAllForPlatform = (platform: (typeof SOCIAL_PLATFORMS)[number]) => {
    setChosenSizes([...new Set([...selectedSizeIds, ...platform.sizeIds.filter(id => enabledFormats.some(size => size.id === id))])]);
  };

  const socialPlatforms = SOCIAL_PLATFORMS.filter(platform => enabledFormats.some(size => size.platform === platform.id && platform.sizeIds.includes(size.id)));
  const nativeFolder = isDesktopApp() && !isMobileShell();
  const destinations: Array<{ id: ExportDestination; label: string; icon: BrandIconName; sub: string }> = [
    { id: 'local-zip', label: STRINGS.exportDialog.destLocalZip, icon: 'archive', sub: 'Single tidy archive' },
    nativeFolder ? { id: 'local-folder', label: STRINGS.exportDialog.destFolder, icon: 'folder', sub: STRINGS.exportDialog.folderHelp }
      : { id: 'local-individual', label: STRINGS.exportDialog.destLocalFiles, icon: 'hard-drive', sub: STRINGS.exportDialog.individualHelp },
  ];

  const currentSettings = (): ExportSettings => ({
    fileFormat, jpegQuality, maxSize: maxSizeChoice, customMaxSize, destination,
    sizeIds: chosenSizes === null ? null : selectedSizeIds, includeBefore, includeAfter, includeOriginal,
  });
  const applySettings = (next: ExportSettings) => {
    setFileFormat(next.fileFormat); setJpegQuality(next.jpegQuality); setMaxSizeChoice(next.maxSize);
    setCustomMaxSize(next.customMaxSize); setChosenSizes(next.sizeIds);
    setDestination(next.destination === 'local-zip' ? 'local-zip' : nativeFolder ? 'local-folder' : 'local-individual');
    setIncludeBefore(next.includeBefore); setIncludeAfter(next.includeAfter); setIncludeOriginal(next.includeOriginal);
  };
  // A preset shows as chosen only while the settings are still its own; change one and the list says so, and choosing it again puts it back.
  const chosenPreset = presets.find((item) => item.id === presetId);
  const shownPresetId = chosenPreset && settingsMatch(chosenPreset.settings, currentSettings(), enabledFormats.map((size) => size.id)) ? presetId : '';
  const choosePreset = (id: string) => {
    setPresetId(id);
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    applySettings(preset.settings);
    setPresetName(preset.name);
    setPresetNote(STRINGS.exportDialog.presetApplied(preset.name));
  };
  const saveCurrentPreset = () => {
    const result = savePreset(presets, presetName, currentSettings(), () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    if ('problem' in result) { setPresetNote(result.problem === 'empty' ? STRINGS.exportDialog.presetEmpty : STRINGS.exportDialog.presetFull); return; }
    const store = deviceStorage();
    if (!store || !writePresets(store, result.presets)) { setPresetNote(STRINGS.exportDialog.presetStoreFailed); return; }
    setPresets(result.presets);
    setPresetId(result.saved.id);
    setPresetName(result.saved.name);
    setPresetNote(STRINGS.exportDialog.presetSaved(result.saved.name));
  };
  const removePreset = () => {
    const next = deletePreset(presets, presetId);
    const store = deviceStorage();
    if (!store || !writePresets(store, next)) { setPresetNote(STRINGS.exportDialog.presetStoreFailed); return; }
    setPresets(next);
    setPresetId('');
    setPresetNote('');
  };

  // The wizard, Export again and saved settings all make their request here (src/v2/engineClient/exportSettings.ts).
  const handleSubmit = (rawMaster = false, rawMasterFormat: 'tiff' | 'png' = 'tiff') => {
    const settings = currentSettings();
    const target = exportTargetFor(photo, selectedPhotoIds, nativeFolder, selectedGroupIds);
    if (!rawMaster) { const store = deviceStorage(); if (store) writeLastExport(store, settings); }
    const request = requestFromSettings(settings, target, rawMaster, rawMasterFormat);
    const kit = !rawMaster && brandKits?.some((item) => item.id === brandKitId) ? brandKitId : '';
    onExport(kit ? { ...request, brandKitId: kit } : request);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={onDialogKeyDown}
      aria-labelledby="export-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] sm:max-h-[88dvh]">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2 sm:px-6 sm:py-4">
          <div>
            <h2 id="export-dialog-title" className="text-base font-bold text-[var(--text-primary)]">
              {STRINGS.exportDialog.heading}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {STRINGS.exportDialog.subtitle}
            </p>
          </div>
          <button
            type="button"
            aria-label={STRINGS.shellLabels.closeExport}
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-contain inflight-scroll p-3 sm:gap-6 sm:p-6 md:grid-cols-12">
          {/* Left column: Saved settings, Destination + Social quick-select */}
          <div className="space-y-5 md:col-span-6">
            <section className="space-y-2" aria-labelledby="export-presets-title" data-testid="export-presets">
              <h3 id="export-presets-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.exportDialog.presetsHeading}</h3>
              {presets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label={STRINGS.exportDialog.presetChoose} value={shownPresetId} onChange={(event) => choosePreset(event.target.value)}
                    className="min-h-10 min-w-0 flex-1 rounded bg-[var(--bg-input)] p-2 text-xs text-[var(--text-primary)]">
                    <option value="">{STRINGS.exportDialog.presetPlaceholder}</option>
                    {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  {shownPresetId && (
                    <button type="button" onClick={removePreset}
                      className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      {STRINGS.exportDialog.presetDelete(presets.find((item) => item.id === presetId)?.name ?? '')}
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={presetName} maxLength={MAX_PRESET_NAME} aria-label={STRINGS.exportDialog.presetName}
                  placeholder={STRINGS.exportDialog.presetName} onChange={(event) => setPresetName(event.target.value)}
                  className="min-h-10 min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]" />
                <button type="button" onClick={saveCurrentPreset}
                  className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                  {STRINGS.exportDialog.presetSave}
                </button>
              </div>
              {presetNote && <p role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">{presetNote}</p>}
            </section>
            {brandKits && onSaveBrandKit && onEditBrandKit && onDeleteBrandKit && (
              <BrandKitSection kits={brandKits} chosenId={brandKitId} onChoose={setBrandKitId} photoId={photo.id}
                onSave={onSaveBrandKit} onEdit={onEditBrandKit} onDelete={onDeleteBrandKit} />
            )}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.destinationHeading}
              </h3>
              <div className="grid grid-cols-1 gap-1.5">
                {destinations.map((dest) => {
                  const active = destination === dest.id;
                  return (
                    <button
                      key={dest.id}
                      type="button"
                      onClick={() => setDestination(dest.id)}
                      aria-pressed={active}
                      className={`flex items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <BrandIcon
                          name={dest.icon}
                          size={15}
                          className={active ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">
                            {dest.label}
                          </span>
                          <span className="block truncate text-[0.625rem] text-[var(--text-muted)]">
                            {dest.sub}
                          </span>
                        </span>
                      </span>
                      {active && <BrandIcon name="check" size={14} className="text-[var(--brand-accent)]" />}
                    </button>
                  );
                })}
              </div>
            </section>
            {canRequestRaw && (
              <section aria-label={STRINGS.exportDialog.rawMasterHeading} className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleSubmit(true, 'tiff')}
                    className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                    {STRINGS.exportDialog.rawMasterButton}
                  </button>
                  <button type="button" onClick={() => handleSubmit(true, 'png')}
                    className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                    {STRINGS.exportDialog.rawMasterPngButton}
                  </button>
                </div>
                <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.exportDialog.rawMasterHelp}</p>
              </section>
            )}

            {socialPlatforms.length > 0 && <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.socialQuickSelect}
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {socialPlatforms.map((sp) => (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => selectAllForPlatform(sp)}
                    className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 text-left text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)]"
                  >
                    <SocialLogo platform={sp.id} size={15} />
                    <span className="truncate">{STRINGS.exportDialog.selectAllFor(sp.label)}</span>
                  </button>
                ))}
              </div>
            </section>}
          </div>

          {/* Right column: Edit Groups, Formats & Variants */}
          <div className="space-y-5 md:col-span-6">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.groupsHeading}
              </h3>
              <div className="space-y-1.5">
                {photoIds.length > 1 ? <p className="text-xs text-[var(--text-secondary)]">{STRINGS.exportDialog.batchActiveGroup}</p> : photo.editGroups.map((g) => {
                  const checked = selectedGroupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      aria-pressed={checked}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:border-[var(--border-default)]"
                    >
                      <BrandIcon
                        name={checked ? 'checkbox-checked' : 'checkbox-empty'}
                        size={15}
                        className={checked ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}
                      />
                      <span className="truncate font-medium">{g.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {enabledFormats.map((size) => {
                  const checked = selectedSizeIds.includes(size.id);
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => toggleSize(size.id)}
                      aria-pressed={checked}
                      className={`flex items-center justify-between gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-xs transition-colors ${
                        checked
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{size.label}</span>
                        <span className="block font-mono text-[0.625rem] text-[var(--text-muted)]">
                          {size.width}×{size.height}{frameCount(size.id) > 1 ? ` · ${STRINGS.exportDialog.frameFiles(frameCount(size.id))}` : ''}
                        </span>
                      </span>
                      <span className="font-mono text-[0.625rem] text-[var(--text-muted)] shrink-0">
                        {size.ratioLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {(includeBefore || includeAfter) && (
              <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4 text-xs">
                <label className="flex items-center justify-between">
                  {STRINGS.exportDialog.fileFormat}
                  <select className="rounded bg-[var(--bg-input)] p-2" value={fileFormat}
                    onChange={(event) => setFileFormat(event.target.value === 'png' ? 'png' : 'jpeg')}>
                    <option value="jpeg">JPEG</option>
                    <option value="png">PNG</option>
                  </select>
                </label>
                {fileFormat === 'jpeg' && (
                  <label className="flex flex-wrap items-center justify-between gap-2">
                    {STRINGS.exportDialog.jpegQuality}
                    <input type="range" min="1" max="100" value={jpegQuality} aria-label={STRINGS.exportDialog.jpegQuality}
                      onChange={(event) => setJpegQuality(Number(event.target.value))} />
                    <output>{jpegQuality}%</output>
                  </label>
                )}
                <label className="flex flex-wrap items-center justify-between gap-2">
                  {STRINGS.exportDialog.maxSize}
                  <select className="rounded bg-[var(--bg-input)] p-2" value={maxSizeChoice}
                    onChange={(event) => setMaxSizeChoice(event.target.value as typeof maxSizeChoice)}>
                    <option value="full">{STRINGS.exportDialog.maxSizeFull}</option>
                    <option value="4096">{STRINGS.exportDialog.maxSizeLongEdge(4096)}</option>
                    <option value="2560">{STRINGS.exportDialog.maxSizeLongEdge(2560)}</option>
                    <option value="1920">{STRINGS.exportDialog.maxSizeLongEdge(1920)}</option>
                    <option value="custom">{STRINGS.exportDialog.maxSizeCustom}</option>
                  </select>
                </label>
                {maxSizeChoice === 'custom' && (
                  <label className="flex flex-wrap items-center justify-between gap-2">
                    {STRINGS.exportDialog.maxSizeCustom}
                    <input type="number" min="1" step="1" inputMode="numeric" value={customMaxSize}
                      aria-label={STRINGS.exportDialog.maxSizeCustom}
                      className="w-24 rounded bg-[var(--bg-input)] p-2"
                      onChange={(event) => setCustomMaxSize(Math.max(1, Math.round(Number(event.target.value) || 1)))} />
                  </label>
                )}
              </section>
            )}

            {/* Versions */}
            <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.variantsHeading}
              </h3>
              <div className="space-y-1.5">
                {[
                  { label: STRINGS.exportDialog.variantBefore(fileFormat.toUpperCase()), val: includeBefore, set: setIncludeBefore },
                  { label: STRINGS.exportDialog.variantAfter, val: includeAfter, set: setIncludeAfter },
                  { label: STRINGS.exportDialog.variantOriginal, val: includeOriginal, set: setIncludeOriginal },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => item.set(!item.val)}
                    aria-pressed={item.val}
                    className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                  >
                    <BrandIcon
                      name={item.val ? 'checkbox-checked' : 'checkbox-empty'}
                      size={15}
                      className={item.val ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <p className="px-2 text-[0.6875rem] text-[var(--text-secondary)]" data-testid="export-overlay-note">
                {canvasOverlays.length
                  ? STRINGS.exportDialog.overlaysAsOnCanvas(new Intl.ListFormat(activeLanguage()).format(canvasOverlays))
                  : STRINGS.exportDialog.noOverlaysOnCanvas}
              </p>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-3.5">
          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
            {selectedPhotoIds.length || 1} {(selectedPhotoIds.length || 1) === 1 ? 'photo' : 'photos'} · {selectedSizeIds.length}{' '}
            {selectedSizeIds.length === 1 ? 'format' : 'formats'} · {photoIds.length > 1 ? 1 : selectedGroupIds.length}{' '}
            {photoIds.length > 1 || selectedGroupIds.length === 1 ? 'group' : 'groups'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {STRINGS.exportDialog.cancel}
            </button>
            <button
              type="button"
              disabled={(!includeBefore && !includeAfter && !includeOriginal) || ((includeBefore || includeAfter) && !photo.sizes.some((size) => size.kind === 'photo' && size.enabled && selectedSizeIds.includes(size.id)))}
              onClick={() => handleSubmit()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] disabled:opacity-50"
            >
              <BrandIcon name="export" size={14} />
              <span>{destination === 'local-zip' ? STRINGS.exportDialog.startExport : STRINGS.exportDialog.saveFiles}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
