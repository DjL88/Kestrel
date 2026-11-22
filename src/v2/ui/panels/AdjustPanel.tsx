import React from 'react';
import type { EditRecipe, LookPreset, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { getActiveGroup } from '../utils/studioMath';

interface AdjustPanelProps {
  photo: Photo | null;
  selectedPhotoCount: number;
  looks: LookPreset[];
  cvdGuidance: boolean;
  calmView: boolean;
  onUpdateRecipe: (photoId: string, patch: Partial<EditRecipe>) => void;
  onApplyLook: (photoId: string, lookId: string) => void;
  onHoverLook: (lookId: string | null) => void;
  onResetPhoto: (photoId: string) => void;
}

interface SliderRowProps {
  id: string;
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  leftHint?: string;
  rightHint?: string;
  calmView: boolean;
  onChange: (val: number) => void;
}

function SliderRow({
  id,
  label,
  tooltip,
  value,
  min,
  max,
  step = 1,
  unit = '',
  leftHint,
  rightHint,
  calmView,
  onChange,
}: SliderRowProps) {
  const formatted =
    step < 1
      ? `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`
      : `${value > 0 ? '+' : ''}${Math.round(value)}${unit}`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">
            {label}
          </label>
          <InfoPopover title={label} body={tooltip} />
        </div>
        {!calmView && (
          <button
            type="button"
            title={`Double-click or click to reset ${label} to 0`}
            onClick={() => onChange(0)}
            className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]"
          >
            {formatted}
          </button>
        )}
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="inflight-slider"
      />

      {(leftHint || rightHint) && (
        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </div>
      )}
    </div>
  );
}

export default function AdjustPanel({
  photo,
  selectedPhotoCount,
  looks,
  cvdGuidance,
  calmView,
  onUpdateRecipe,
  onApplyLook,
  onHoverLook,
  onResetPhoto,
}: AdjustPanelProps) {
  const [activeTab, setActiveTab] = React.useState<'looks' | 'advanced'>('looks');
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to adjust tone and colour.</p>;
  }

  const group = getActiveGroup(photo);
  const recipe = group.recipe;

  return (
    <div className="space-y-5">
      {selectedPhotoCount > 1 && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--brand-accent-border)] bg-[var(--brand-accent-soft)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-accent)]">
          Group edit active: sliders apply to {selectedPhotoCount} selected photos
        </div>
      )}

      <div role="tablist" aria-label="Adjust tools" className="grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-input)] p-1">
        <button type="button" role="tab" id="adjust-looks-tab" aria-selected={activeTab === 'looks'}
          aria-controls="adjust-looks-panel" tabIndex={activeTab === 'looks' ? 0 : -1}
          onClick={() => setActiveTab('looks')}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab('advanced'); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#adjust-advanced-tab')?.focus(); } }}
          className={`rounded-[var(--radius-sm)] px-2 py-2 text-xs font-medium ${activeTab === 'looks' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          Curated Looks
        </button>
        <button type="button" role="tab" id="adjust-advanced-tab" aria-selected={activeTab === 'advanced'}
          aria-controls="adjust-advanced-panel" tabIndex={activeTab === 'advanced' ? 0 : -1}
          onClick={() => { onHoverLook(null); setActiveTab('advanced'); }}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onHoverLook(null); setActiveTab('looks'); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#adjust-looks-tab')?.focus(); } }}
          className={`rounded-[var(--radius-sm)] px-2 py-2 text-xs font-medium ${activeTab === 'advanced' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          Advanced Edits
        </button>
      </div>
      <div role="tabpanel" id="adjust-looks-panel" aria-labelledby="adjust-looks-tab" hidden={activeTab !== 'looks'}>
      {/* Curated Looks (12 looks with live thumbnail preview + hover main photo preview + direct slider update on click) */}
      <section aria-labelledby="looks-heading" className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 id="looks-heading" className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.adjust.looksHeading}
          </h3>
          <span className="text-[10px] text-[var(--text-muted)]">{looks.length} styles</span>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.adjust.looksHint}</p>

        <div
          className="grid grid-cols-2 gap-2"
          onMouseLeave={() => onHoverLook(null)}
        >
          {looks.map((look) => {
            const active = recipe.lookId === look.id;
            return (
              <button
                key={look.id}
                type="button"
                title={look.description}
                onMouseEnter={() => onHoverLook(look.id)}
                onFocus={() => onHoverLook(look.id)}
                onBlur={() => onHoverLook(null)}
                onClick={() => onApplyLook(photo.id, look.id)}
                className={`group flex flex-col overflow-hidden rounded-[var(--radius-sm)] border text-left transition-colors ${
                  active
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                }`}
              >
                <div className="aspect-[16/10] w-full overflow-hidden bg-[var(--bg-canvas)]">
                  <img
                    src={photo.thumbUrl}
                    alt={`${look.name} preview`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    style={{ filter: look.previewFilter }}
                  />
                </div>
                <span
                  className={`truncate px-2 py-1.5 text-[11px] font-medium ${
                    active ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {look.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      </div>
      <div role="tabpanel" id="adjust-advanced-panel" aria-labelledby="adjust-advanced-tab" hidden={activeTab !== 'advanced'}>
      {/* Light & Tone (Exposure up to ±5 stops + i hover lightboxes) */}
      <section aria-labelledby="light-tone-heading" className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
        <div className="flex items-center justify-between">
          <h3 id="light-tone-heading" className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.adjust.lightToneHeading}
          </h3>
          <button
            type="button"
            onClick={() => onResetPhoto(photo.id)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]"
          >
            <BrandIcon name="restore" size={12} />
            <span>{STRINGS.adjust.resetPhoto}</span>
          </button>
        </div>

        <SliderRow
          id="slider-exposure"
          label="Exposure"
          tooltip={STRINGS.adjust.tooltips.exposure}
          value={recipe.exposure}
          min={-5}
          max={5}
          step={0.1}
          unit={` ${STRINGS.adjust.stopsSuffix}`}
          leftHint="-5 EV"
          rightHint="+5 EV"
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { exposure: v })}
        />
        <SliderRow
          id="slider-highlights"
          label="Highlights"
          tooltip={STRINGS.adjust.tooltips.highlights}
          value={recipe.highlights}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { highlights: v })}
        />
        <SliderRow
          id="slider-shadows"
          label="Shadows"
          tooltip={STRINGS.adjust.tooltips.shadows}
          value={recipe.shadows}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { shadows: v })}
        />
        <SliderRow
          id="slider-contrast"
          label="Contrast"
          tooltip={STRINGS.adjust.tooltips.contrast}
          value={recipe.contrast}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { contrast: v })}
        />
        <SliderRow
          id="slider-whites"
          label="Whites"
          tooltip={STRINGS.adjust.tooltips.whites}
          value={recipe.whites}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { whites: v })}
        />
        <SliderRow
          id="slider-blacks"
          label="Blacks"
          tooltip={STRINGS.adjust.tooltips.blacks}
          value={recipe.blacks}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { blacks: v })}
        />
      </section>

      {/* Colour & Clarity */}
      <section aria-labelledby="colour-heading" className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
        <h3 id="colour-heading" className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.adjust.colourHeading}
        </h3>

        <SliderRow
          id="slider-temperature"
          label="Temperature"
          tooltip={STRINGS.adjust.tooltips.temperature}
          value={recipe.temperature}
          min={-100}
          max={100}
          leftHint={cvdGuidance ? 'Cooler (Blue)' : 'Cool'}
          rightHint={cvdGuidance ? 'Warmer (Amber)' : 'Warm'}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { temperature: v })}
        />
        <SliderRow
          id="slider-tint"
          label="Tint"
          tooltip={STRINGS.adjust.tooltips.tint}
          value={recipe.tint}
          min={-100}
          max={100}
          leftHint={cvdGuidance ? 'Green bias' : undefined}
          rightHint={cvdGuidance ? 'Magenta bias' : undefined}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { tint: v })}
        />
        <SliderRow
          id="slider-vibrance"
          label="Vibrance"
          tooltip={STRINGS.adjust.tooltips.vibrance}
          value={recipe.vibrance}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { vibrance: v })}
        />
        <SliderRow
          id="slider-saturation"
          label="Saturation"
          tooltip={STRINGS.adjust.tooltips.saturation}
          value={recipe.saturation}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { saturation: v })}
        />
        <SliderRow
          id="slider-clarity"
          label="Clarity"
          tooltip={STRINGS.adjust.tooltips.clarity}
          value={recipe.clarity}
          min={-100}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { clarity: v })}
        />
        <SliderRow
          id="slider-sharpen"
          label="Sharpen"
          tooltip={STRINGS.adjust.tooltips.sharpen}
          value={recipe.sharpen}
          min={0}
          max={100}
          calmView={calmView}
          onChange={(v) => onUpdateRecipe(photo.id, { sharpen: v })}
        />
      </section>
      </div>
    </div>
  );
}
