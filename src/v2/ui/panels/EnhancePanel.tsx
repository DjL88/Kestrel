import React from 'react';
import type { EditRecipe, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { getActiveGroup } from '../utils/studioMath';

interface EnhancePanelProps {
  photo: Photo | null;
  calmView: boolean;
  onUpdateRecipe: (photoId: string, patch: Partial<EditRecipe>) => void;
}

export default function EnhancePanel({
  photo,
  calmView,
  onUpdateRecipe,
}: EnhancePanelProps) {
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">Select a photo to enhance detail and denoise.</p>;
  }

  const recipe = getActiveGroup(photo).recipe;

  return (
    <div className="space-y-5">
      {/* Noise Reduction */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.enhance.denoiseHeading}
        </h3>

        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-[var(--text-primary)]">
              {STRINGS.enhance.rawAiDenoise}
            </span>
            <InfoPopover
              title={STRINGS.enhance.rawAiDenoise}
              body={STRINGS.enhance.tooltips.rawAiDenoise}
            />
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={recipe.denoiseRawAi}
            onClick={() => onUpdateRecipe(photo.id, { denoiseRawAi: !recipe.denoiseRawAi })}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              recipe.denoiseRawAi
                ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
            }`}
          >
            {recipe.denoiseRawAi ? 'On' : 'Off'}
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs text-[var(--text-primary)]">
              <label htmlFor="denoise-luma">{STRINGS.enhance.luminanceDenoise}</label>
              <InfoPopover
                title={STRINGS.enhance.luminanceDenoise}
                body={STRINGS.enhance.tooltips.luminanceDenoise}
              />
            </span>
            {!calmView && (
              <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                {recipe.denoiseLuminance}
              </span>
            )}
          </div>
          <input
            id="denoise-luma"
            type="range"
            min={0}
            max={100}
            value={recipe.denoiseLuminance}
            onChange={(e) => onUpdateRecipe(photo.id, { denoiseLuminance: Number(e.target.value) })}
            className="inflight-slider"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs text-[var(--text-primary)]">
              <label htmlFor="denoise-colour">{STRINGS.enhance.colourDenoise}</label>
              <InfoPopover
                title={STRINGS.enhance.colourDenoise}
                body={STRINGS.enhance.tooltips.colourDenoise}
              />
            </span>
            {!calmView && (
              <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                {recipe.denoiseColour}
              </span>
            )}
          </div>
          <input
            id="denoise-colour"
            type="range"
            min={0}
            max={100}
            value={recipe.denoiseColour}
            onChange={(e) => onUpdateRecipe(photo.id, { denoiseColour: Number(e.target.value) })}
            className="inflight-slider"
          />
        </div>
      </section>

      {/* Upscaling & Detail */}
      <section className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.enhance.upscaleHeading}
        </h3>

        <div className="space-y-1.5">
          <span className="text-xs text-[var(--text-secondary)]">{STRINGS.enhance.upscaleFactor}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {([1, 2, 4] as const).map((factor) => (
              <button
                key={factor}
                type="button"
                onClick={() => onUpdateRecipe(photo.id, { upscaleFactor: factor })}
                className={`h-9 rounded-[var(--radius-sm)] border font-mono text-xs font-semibold transition-colors ${
                  recipe.upscaleFactor === factor
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {factor}×
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs text-[var(--text-primary)]">
              <label htmlFor="detail-recovery">{STRINGS.enhance.detailRecovery}</label>
              <InfoPopover
                title={STRINGS.enhance.detailRecovery}
                body={STRINGS.enhance.tooltips.detailRecovery}
              />
            </span>
            {!calmView && (
              <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                {recipe.detailRecovery}
              </span>
            )}
          </div>
          <input
            id="detail-recovery"
            type="range"
            min={0}
            max={100}
            value={recipe.detailRecovery}
            onChange={(e) => onUpdateRecipe(photo.id, { detailRecovery: Number(e.target.value) })}
            className="inflight-slider"
          />
        </div>

        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
            <BrandIcon name="camera-settings" size={14} className="text-[var(--text-secondary)]" />
            <span>{STRINGS.enhance.lensCorrection}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={recipe.lensCorrection}
            onClick={() => onUpdateRecipe(photo.id, { lensCorrection: !recipe.lensCorrection })}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              recipe.lensCorrection
                ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
            }`}
          >
            {recipe.lensCorrection ? 'On' : 'Off'}
          </button>
        </div>
      </section>
    </div>
  );
}
