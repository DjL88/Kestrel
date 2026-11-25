import { useEffect, useState } from 'react';
import { VEHICLE_LABELS } from '../../../core/vehicleLabels';
import { vehicleText as t } from '../../../i18n/areas/vehicles';
import type { Photo } from '../contract';

const NOT_A_VEHICLE = 'not-a-vehicle';
const kinds = VEHICLE_LABELS.kinds.filter((kind) => !kind.decoy);

/**
 * Photo Info: what vehicle the photo shows, and the person's one correction, for this photo or the whole burst. Their
 * choice replaces the guess (no "probably") and is never undone by a later scan.
 */
export default function VehicleRow({ photo, onCorrect }: {
  photo: Photo;
  onCorrect: (photoId: string, choice: { kind: string; type?: string } | 'not-a-vehicle', wholeBurst: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState(photo.vehicleKind ?? kinds[0].id);
  const [type, setType] = useState(photo.vehicleType ?? '');
  const burstCount = photo.burst && !photo.burst.ungrouped ? photo.burst.count : 1;
  const [wholeBurst, setWholeBurst] = useState(true);
  useEffect(() => {
    setEditing(false);
    setKind(photo.vehicleKind ?? kinds[0].id);
    setType(photo.vehicleType ?? '');
  }, [photo.id, photo.vehicleKind, photo.vehicleType]);
  if (!photo.vehicleLabel) return null;
  const types = VEHICLE_LABELS.types.filter((entry) => entry.kind === kind);
  const select = 'min-w-0 max-w-44 rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]';

  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="shrink-0 text-[var(--text-muted)]">{t.heading}</dt>
      {editing ? (
        <form className="flex min-w-0 flex-1 flex-col items-end gap-1" onSubmit={(event) => {
          event.preventDefault();
          onCorrect(photo.id, kind === NOT_A_VEHICLE ? NOT_A_VEHICLE : { kind, ...(type ? { type } : {}) }, burstCount > 1 && wholeBurst);
          setEditing(false);
        }}>
          <label className="flex items-center gap-1">
            <span className="text-[var(--text-muted)]">{t.correct.kindLabel}</span>
            <select className={select} value={kind} onChange={(event) => { setKind(event.target.value); setType(''); }}>
              {kinds.map((entry) => <option key={entry.id} value={entry.id}>{(t.kinds as Record<string, string>)[entry.id] ?? entry.id}</option>)}
              <option value={NOT_A_VEHICLE}>{t.correct.notVehicle}</option>
            </select>
          </label>
          {kind !== NOT_A_VEHICLE && types.length > 1 && (
            <label className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">{t.correct.typeLabel}</span>
              <select className={select} value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">{t.correct.typeUnknown}</option>
                {types.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
          )}
          {burstCount > 1 && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={wholeBurst} onChange={(event) => setWholeBurst(event.target.checked)} />
              <span>{t.correct.wholeBurst(burstCount)}</span>
            </label>
          )}
          <span className="flex gap-1">
            <button type="submit" className="rounded border border-[var(--border-default)] px-2 py-1">{t.correct.save}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded px-1 py-1">{t.correct.cancel}</button>
          </span>
        </form>
      ) : (
        <dd className="flex min-w-0 items-center gap-2 text-right text-[var(--text-primary)]">
          <span>{photo.vehicleLabel}</span>
          <button type="button" aria-label={t.correct.change} title={t.correct.change} onClick={() => setEditing(true)}
            className="shrink-0 rounded border border-[var(--border-subtle)] px-2 py-1 text-[0.6875rem]">{t.correct.edit}</button>
        </dd>
      )}
    </div>
  );
}
