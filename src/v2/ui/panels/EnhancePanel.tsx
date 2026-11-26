import React from 'react';
import type { EditRecipe, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { getActiveGroup } from '../utils/studioMath';
import { UNMAPPED_KEYS } from '../../engineClient/recipeMap';
import type { TrueDetailJob } from '../utils/trueDetailJob';

/** A displayed Enhance control is enabled only if the real engine can honour its value. */
const unsupported = (key: keyof EditRecipe): boolean =>
  (UNMAPPED_KEYS as readonly (keyof EditRecipe)[]).includes(key);
const unsupportedHelp = 'Unavailable: this control does not yet change the photograph or export.';

interface EnhancePanelProps {
  photo: Photo | null;
  hideReadouts: boolean;
  onUpdateRecipe: (photoId: string, patch: Partial<EditRecipe>) => void;
  onDenoise?: (photoId: string) => void;
  /** This photo's TrueDetail job while it waits or runs: shown on the button that started it. */
  trueDetail?: TrueDetailJob | null;
  /** Show the selected format exactly as export will make it, Output scale included. Absent where there is no engine. */
  onPreviewEnlargement?: () => void;
  /** Whether this plan includes cloud processing. */
  cloudEnabled?: boolean;
}

export default function EnhancePanel({
  photo,
  hideReadouts,
  onUpdateRecipe,
  onDenoise, onPreviewEnlargement,
  trueDetail = null,
  cloudEnabled = false,
}: EnhancePanelProps) {
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToEnhance}</p>;
  }

  const recipe = getActiveGroup(photo).recipe;

  return (
    <div className="space-y-5">
      <p id="v2-enhance-unavailable" role="status" className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">
        {STRINGS.panelWords.unavailableNote}
      </p>
      {/* Noise Reduction */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          {STRINGS.enhance.denoiseHeading}
        </h3>

        {onDenoise && (
          <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2.5">
            {/* Owner, 26 Nov: it only showed in Tasks. While it waits or runs, the button says so and shows how far it has got. */}
            <button
              type="button"
              data-testid="truedetail-run"
              onClick={() => onDenoise(photo.id)}
              disabled={Boolean(trueDetail)}
              aria-busy={Boolean(trueDetail)}
              className="relative h-8 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-xs font-medium text-[var(--text-on-accent)] disabled:cursor-progress disabled:bg-[var(--brand-accent-soft)] disabled:text-[var(--text-primary)]"
            >
              {trueDetail?.state === 'running' && (
                <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-[var(--brand-accent)] opacity-40" style={{ width: `${trueDetail.percent}%` }} />
              )}
              <span className="relative">{trueDetail ? (trueDetail.state === 'running' ? STRINGS.enhance.trueDetailRunning(trueDetail.percent) : STRINGS.enhance.trueDetailQueued) : STRINGS.enhance.denoiseNow}</span>
            </button>
            {trueDetail && <p role="status" className="sr-only">{trueDetail.state === 'running' ? STRINGS.enhance.trueDetailRunning(trueDetail.percent) : STRINGS.enhance.trueDetailQueued}</p>}
            <p className="text-[0.6875rem] text-[var(--text-muted)]">
              {cloudEnabled ? STRINGS.enhance.denoiseCloudNote : STRINGS.enhance.denoiseDeviceNote}
            </p>
          </div>
        )}

        {recipe.aiDenoise && (
          <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2.5">
            <p className="text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.enhance.aiDenoiseInUse}</p>
            <button
              type="button"
              onClick={() => onUpdateRecipe(photo.id, { aiDenoise: false })}
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 text-xs font-medium text-[var(--text-primary)]"
            >
              {STRINGS.enhance.aiDenoiseOff}
            </button>
          </div>
        )}

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
            aria-label={STRINGS.enhance.rawAiDenoise}
            aria-describedby="v2-enhance-unavailable"
            data-testid="v2-enhance-raw-ai"
            disabled={unsupported('denoiseRawAi')}
            title={unsupported('denoiseRawAi') ? unsupportedHelp : undefined}
            onClick={() => onUpdateRecipe(photo.id, { denoiseRawAi: !recipe.denoiseRawAi })}
            className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
            {!hideReadouts && (
              <span className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums">
                {recipe.denoiseLuminance}
              </span>
            )}
          </div>
          <input
            id="denoise-luma"
            type="range"
            data-testid="v2-enhance-luminance"
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
            {!hideReadouts && (
              <span className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums">
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
          {onPreviewEnlargement && recipe.upscaleFactor !== 1 && (
            <button type="button" data-testid="v2-preview-enlargement" onClick={onPreviewEnlargement}
              className="mt-1 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
              <BrandIcon name="search" size={13} />
              <span>{STRINGS.panelWords.enlargementPreview}</span>
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs text-[var(--text-primary)]">
              <label htmlFor="detail-recovery">{STRINGS.panelWords.texture}</label>
              <InfoPopover
                title={STRINGS.panelWords.texture}
                body="Adds contrast to fine detail that is already present. It cannot restore missing detail or invent feathers."
              />
            </span>
            {!hideReadouts && (
              <span className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums">
                {recipe.detailRecovery}
              </span>
            )}
          </div>
          <input
            id="detail-recovery"
            type="range"
            data-testid="v2-enhance-texture"
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
            aria-label={STRINGS.enhance.lensCorrection}
            aria-describedby="v2-enhance-unavailable"
            data-testid="v2-enhance-lens-correction"
            disabled={unsupported('lensCorrection')}
            title={unsupported('lensCorrection') ? unsupportedHelp : undefined}
            onClick={() => onUpdateRecipe(photo.id, { lensCorrection: !recipe.lensCorrection })}
            className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
