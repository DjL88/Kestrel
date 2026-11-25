import React from 'react';
import type { HealSpotChange, Photo } from '../contract';
import { healText as T } from '../../../i18n/areas/heal';
import BrandIcon from '../icons/BrandIcon';

interface HealSectionProps {
  photo: Photo;
  /** True while clicks on the photo place spots. */
  placing: boolean;
  onSetPlacing: (placing: boolean) => void;
  /** The size new spots get, 1 to 100. */
  newSize: number;
  onSetNewSize: (size: number) => void;
  selectedId: string | null;
  onSelect: (spotId: string | null) => void;
  /** A short message about the last action, in plain words. */
  note?: string;
  busy?: boolean;
  onUpdate: (photoId: string, spotId: string, change: HealSpotChange) => void;
  onNextSource: (photoId: string, spotId: string) => void;
  onRemove: (photoId: string, spotId: string) => void;
  onClear: (photoId: string) => void;
  /** Called with true while this section is on screen, so the photo shows the spots only then. */
  onShown?: (shown: boolean) => void;
}

const sliderRow = (id: string, label: string, value: number, onChange: (value: number) => void, testId: string) => (
  <label className="block space-y-1 text-[0.6875rem] text-[var(--text-secondary)]">
    <span className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
    <input id={id} type="range" className="inflight-slider" data-testid={testId} aria-label={label}
      min={1} max={100} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
);

/**
 * Spot healing: place spots on the photo, then adjust each one. Every change is a step in History and lives in the
 * photo's recipe; the pixels placed are always copied from the same photo.
 */
export default function HealSection({
  photo, placing, onSetPlacing, newSize, onSetNewSize, selectedId, onSelect, note, busy,
  onUpdate, onNextSource, onRemove, onClear, onShown,
}: HealSectionProps) {
  React.useEffect(() => {
    onShown?.(true);
    return () => onShown?.(false);
  }, [onShown]);
  const spots = photo.healSpots ?? [];
  const selected = spots.find((spot) => spot.id === selectedId);
  const index = selected ? spots.indexOf(selected) + 1 : 0;
  return (
    <section className="space-y-2.5 border-b border-[var(--border-subtle)] pb-4" aria-labelledby="v2-heal-heading" data-testid="v2-heal">
      <h3 id="v2-heal-heading" className="text-xs font-semibold text-[var(--text-primary)]">
        {T.title} <span className="font-normal text-[var(--text-muted)]">· {T.count(spots.length)}</span>
      </h3>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--text-secondary)]">{T.intro}</p>
      <button
        type="button"
        data-testid="v2-heal-place"
        aria-pressed={placing}
        onClick={() => onSetPlacing(!placing)}
        className={`flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 text-xs font-medium transition-colors ${
          placing
            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] hover:border-[var(--border-default)]'
        }`}
      >
        <BrandIcon name={placing ? 'check' : 'brush'} size={14} />
        <span>{placing ? T.stop : T.start}</span>
      </button>
      {placing && <p className="text-[0.6875rem] text-[var(--text-secondary)]">{T.placing}</p>}
      {sliderRow('v2-heal-new-size', T.size, newSize, onSetNewSize, 'v2-heal-new-size')}
      <p role="status" aria-live="polite" data-testid="v2-heal-note" className="min-h-[1em] text-[0.6875rem] text-[var(--text-secondary)]">
        {busy ? T.working : note ?? ''}
      </p>
      {spots.length === 0 ? (
        <p className="text-[0.6875rem] text-[var(--text-muted)]">{T.empty}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="v2-heal-list">
          {spots.map((spot, position) => {
            const open = spot.id === selectedId;
            const name = T.spot(position + 1);
            return (
              <li key={spot.id} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <button type="button" aria-label={`${spot.visible ? T.hide : T.show}: ${name}`} aria-pressed={spot.visible}
                    onClick={() => onUpdate(photo.id, spot.id, { visible: !spot.visible })} className="text-[var(--text-muted)]">
                    <BrandIcon name={spot.visible ? 'eye' : 'eye-off'} size={14} className={spot.visible ? 'text-[var(--brand-accent)]' : ''} />
                  </button>
                  <button type="button" aria-expanded={open} onClick={() => onSelect(open ? null : spot.id)}
                    className="min-w-0 flex-1 truncate text-left text-xs text-[var(--text-primary)]">
                    <span className={spot.visible ? '' : 'opacity-50'}>{name}</span>
                    <span className="ml-2 text-[0.625rem] text-[var(--text-muted)]">
                      {spot.mode === 'heal' ? T.heal.split(':')[0] : T.clone.split(':')[0]}{spot.visible ? '' : ` · ${T.hidden}`}
                    </span>
                  </button>
                  <button type="button" aria-label={`${T.remove}: ${name}`} onClick={() => onRemove(photo.id, spot.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--semantic-danger)]">
                    <BrandIcon name="trash" size={13} />
                  </button>
                </div>
                {open && selected && (
                  <div className="space-y-2 border-t border-[var(--border-subtle)] px-2.5 py-2.5" data-testid="v2-heal-spot">
                    {sliderRow(`v2-heal-size-${spot.id}`, `${T.size} (${T.spot(index)})`, spot.size, (value) => onUpdate(photo.id, spot.id, { size: value }), 'v2-heal-size')}
                    {sliderRow(`v2-heal-feather-${spot.id}`, `${T.feather} (${T.spot(index)})`, spot.feather, (value) => onUpdate(photo.id, spot.id, { feather: value }), 'v2-heal-feather')}
                    <fieldset className="space-y-1">
                      <legend className="text-[0.6875rem] font-semibold text-[var(--text-primary)]">{T.method}</legend>
                      {(['heal', 'clone'] as const).map((mode) => (
                        <label key={mode} className="flex items-center gap-2 text-[0.6875rem] text-[var(--text-secondary)]">
                          <input type="radio" name={`v2-heal-mode-${spot.id}`} value={mode} checked={spot.mode === mode}
                            data-testid={`v2-heal-mode-${mode}`} onChange={() => onUpdate(photo.id, spot.id, { mode })} />
                          <span>{mode === 'heal' ? T.heal : T.clone}</span>
                        </label>
                      ))}
                    </fieldset>
                    <button type="button" data-testid="v2-heal-next-source" disabled={busy} onClick={() => onNextSource(photo.id, spot.id)}
                      className="flex h-8 w-full items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:border-[var(--border-default)] disabled:opacity-50">
                      {T.nextSource}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {spots.length > 1 && (
        <button type="button" onClick={() => onClear(photo.id)} data-testid="v2-heal-clear"
          className="text-[0.6875rem] font-medium text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]">
          {T.removeAll}
        </button>
      )}
    </section>
  );
}
