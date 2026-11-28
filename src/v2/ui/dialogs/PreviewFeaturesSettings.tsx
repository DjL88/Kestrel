import { useState, useSyncExternalStore } from 'react';
import { FEATURES } from '../../../core/features';
import { PREVIEW_FEATURES, previewOn, previewsVersion, setPreview, subscribePreviews, type PreviewFeature } from '../../../core/previewFeatures';
import { previewText as t } from '../../../i18n/areas/preview';
import { useAccess } from '../../../providers/useAccess';

const words = t as Record<string, string>;

/** How a preview stands on this device: its own switch, or already on for everyone, or on because an admin said so. */
export type PreviewStanding = 'switch' | 'everyone' | 'admin';

export function previewStanding(item: PreviewFeature, featureOn: (feature: NonNullable<PreviewFeature['feature']>) => boolean): PreviewStanding {
  if (!item.feature || !featureOn(item.feature)) return 'switch';
  return FEATURES[item.feature] === 'free' ? 'everyone' : 'admin';
}

/**
 * Settings → Preview features: the device-local switches for features that are still being proven, each with a plain
 * name, one honest line about it, and a switch that says On or Off in words. A preview that is already on for
 * everyone, or that an admin flag turned on, is shown as on and cannot be switched here. Nothing is turned on by
 * default and nothing is sent anywhere.
 */
export default function PreviewFeaturesSettings() {
  useSyncExternalStore(subscribePreviews, previewsVersion, previewsVersion);
  const { can } = useAccess();
  const [failed, setFailed] = useState(false);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());

  const toggle = (item: PreviewFeature) => {
    const wasOn = previewOn(item.id as never);
    const saved = setPreview(item.id as never, !wasOn);
    setFailed(!saved);
    if (saved && item.needsRestart) setChanged((previous) => new Set(previous).add(item.id));
  };

  return (
    <div className="space-y-4" data-testid="preview-features">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{t.intro}</p>
      {failed && <p role="alert" className="text-xs text-[var(--text-primary)]">{t.saveFailed}</p>}
      <ul className="space-y-3" aria-label={t.tab}>
        {PREVIEW_FEATURES.map((item) => {
          const standing = previewStanding(item, can);
          const on = standing !== 'switch' || previewOn(item.id as never);
          const name = words[item.nameKey];
          const stateWords = standing === 'everyone' ? t.everyone : standing === 'admin' ? t.admin : on ? t.on : t.off;
          return (
            <li key={item.id} data-preview-id={item.id}
              className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                  {name}{' '}
                  <span className="ml-1 rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[0.625rem] font-medium text-[var(--text-muted)]">{t.badge}</span>
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{words[item.descriptionKey]}</p>
                {item.needsRestart && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <span>{t.restartNote}</span>
                    {changed.has(item.id) && (
                      <button type="button" onClick={() => window.location.reload()}
                        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-0.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                        {t.restartNow}
                      </button>
                    )}
                  </p>
                )}
              </div>
              {standing === 'switch' ? (
                <button type="button" role="switch" aria-checked={on} aria-label={name} onClick={() => toggle(item)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${on
                    ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                  {stateWords}
                </button>
              ) : (
                <span role="status" aria-label={`${name}: ${stateWords}`}
                  className="shrink-0 rounded-full bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                  {stateWords}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
