import React, { useState } from 'react';
import type {
  ExportDestination,
  ExportRequest,
  FeatureKey,
  Photo,
  SocialPlatform,
  StorageConnector,
} from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { SocialLogo, type BrandIconName } from '../icons/BrandIcon';

interface ExportDialogProps {
  open: boolean;
  photo: Photo | null;
  selectedPhotoIds: string[];
  storageConnectors: StorageConnector[];
  features: Record<FeatureKey, boolean>;
  onClose: () => void;
  onExport: (request: ExportRequest) => void;
}

const SOCIAL_PLATFORMS: Array<{ id: SocialPlatform; label: string; sizeIds: string[] }> = [
  { id: 'instagram', label: 'Instagram', sizeIds: ['ig-portrait', 'ig-square', 'ig-story', 'video-zoom'] },
  { id: 'youtube', label: 'YouTube', sizeIds: ['yt-wide', 'orig-3x2'] },
  { id: 'x', label: 'X', sizeIds: ['x-feed', 'orig-3x2'] },
  { id: 'linkedin', label: 'LinkedIn', sizeIds: ['x-feed', 'ig-square'] },
  { id: 'tiktok', label: 'TikTok', sizeIds: ['ig-story', 'video-zoom'] },
  { id: 'pinterest', label: 'Pinterest', sizeIds: ['ig-portrait'] },
];

export default function ExportDialog({
  open,
  photo,
  selectedPhotoIds,
  storageConnectors,
  features,
  onClose,
  onExport,
}: ExportDialogProps) {
  const [destination, setDestination] = useState<ExportDestination>('local-zip');
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(['group-primary']);
  const [includeBefore, setIncludeBefore] = useState(false);
  const [includeAfter, setIncludeAfter] = useState(true);
  const [includeOverlay, setIncludeOverlay] = useState(false);
  const [includeWatermark, setIncludeWatermark] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);

  if (!open || !photo) return null;

  const toggleSize = (id: string) => {
    setSelectedSizeIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((g) => g !== id) : prev) : [...prev, id]
    );
  };

  const selectAllForPlatform = (platform: (typeof SOCIAL_PLATFORMS)[number]) => {
    setSelectedSizeIds((prev) => Array.from(new Set([...prev, ...platform.sizeIds])));
    if (platform.sizeIds.includes('video-zoom') && features.zoomVideo) {
      setIncludeVideo(true);
    }
  };

  // Only the two local download routes are implemented by planExport. A connector being
  // connected in Settings does not mean the export renderer can write to it.
  const destinations: Array<{ id: ExportDestination; label: string; icon: BrandIconName; sub: string }> = [
    { id: 'local-zip', label: STRINGS.exportDialog.destLocalZip, icon: 'archive', sub: 'Single tidy archive' },
    { id: 'local-individual', label: STRINGS.exportDialog.destLocalFiles, icon: 'hard-drive', sub: 'Save directly to folder' },
  ];

  const availableSizeIds = photo.sizes.filter((size) => size.kind === 'photo').map((size) => size.id);
  const effectiveSizeIds = selectedSizeIds.length ? selectedSizeIds.filter((id) => availableSizeIds.includes(id)) : availableSizeIds.slice(0, 1);

  const handleSubmit = () => {
    onExport({
      destination,
      groupIds: selectedGroupIds,
      sizeIds: effectiveSizeIds,
      includeBefore,
      includeAfter,
      includeOverlay,
      includeWatermark,
      includeVideo,
      photoIds: selectedPhotoIds.length > 0 ? selectedPhotoIds : [photo.id],
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] sm:max-h-[88dvh]">
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
            aria-label="Close export dialog"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-contain inflight-scroll p-3 sm:gap-6 sm:p-6 md:grid-cols-12">
          {/* Left column: Destination + Social quick-select */}
          <div className="space-y-5 md:col-span-6">
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
                          <span className="block truncate text-[10px] text-[var(--text-muted)]">
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

            {/* Quick-select by social platform */}
            <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.socialQuickSelect}
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {SOCIAL_PLATFORMS.map((sp) => (
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
            </section>
          </div>

          {/* Right column: Edit Groups, Formats & Variants */}
          <div className="space-y-5 md:col-span-6">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.groupsHeading}
              </h3>
              <div className="space-y-1.5">
                {photo.editGroups.map((g) => {
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
                {photo.sizes.map((size) => {
                  const checked = effectiveSizeIds.includes(size.id);
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => setSelectedSizeIds((previous) => { const current = previous.length ? previous : availableSizeIds.slice(0, 1); return current.includes(size.id) ? current.filter((id) => id !== size.id) : [...current, size.id]; })}
                      aria-pressed={checked}
                      className={`flex items-center justify-between gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-xs transition-colors ${
                        checked
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <span className="truncate">{size.label}</span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">
                        {size.ratioLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Versions */}
            <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {STRINGS.exportDialog.variantsHeading}
              </h3>
              <div className="space-y-1.5">
                <p className="text-xs text-[var(--text-secondary)]">Only edited JPEG downloads are available. Before, text overlays, watermarks and video cannot yet be included in the saved file.</p>
                {[
                  { label: STRINGS.exportDialog.variantBefore, val: includeBefore, set: setIncludeBefore, unavailable: true },
                  { label: STRINGS.exportDialog.variantAfter, val: includeAfter, set: setIncludeAfter, unavailable: false },
                  { label: STRINGS.exportDialog.variantOverlay, val: includeOverlay, set: setIncludeOverlay, unavailable: true },
                  { label: STRINGS.exportDialog.variantWatermark, val: includeWatermark, set: setIncludeWatermark, unavailable: true },
                  ...(features.zoomVideo
                    ? [{ label: STRINGS.exportDialog.variantVideo, val: includeVideo, set: setIncludeVideo, unavailable: true }]
                    : []),
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => item.set(!item.val)}
                    disabled={item.unavailable}
                    aria-pressed={item.val}
                    className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-3.5">
          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
            {selectedPhotoIds.length || 1} {(selectedPhotoIds.length || 1) === 1 ? 'photo' : 'photos'} · {effectiveSizeIds.length}{' '}
            {effectiveSizeIds.length === 1 ? 'format' : 'formats'} · {selectedGroupIds.length}{' '}
            {selectedGroupIds.length === 1 ? 'group' : 'groups'}
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
              disabled={effectiveSizeIds.length === 0 || !includeAfter}
              onClick={handleSubmit}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] disabled:opacity-50"
            >
              <BrandIcon name="export" size={14} />
              <span>{STRINGS.exportDialog.startExport}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
