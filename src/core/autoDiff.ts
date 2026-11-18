import { DETAIL_CONTROLS, TONE_CONTROLS, type PhotoEdit } from './photoEdits';

export interface EditDelta {
  key: string;
  label: string;
  beforeText: string;
  afterText: string;
}

const ALL_NUMERIC_LABELS: Array<{ key: keyof PhotoEdit; label: string }> = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'tint', label: 'Tint' },
  { key: 'colour', label: 'Colour' },
  ...TONE_CONTROLS,
  ...DETAIL_CONTROLS,
  { key: 'denoise', label: 'Noise reduction' },
];

function formatValue(key: keyof PhotoEdit, value: number): string {
  if (key === 'exposure') {
    const ev = value * 0.4;
    return `${ev > 0 ? '+' : ''}${ev.toFixed(2)} EV`;
  }
  if (key === 'warmth' || key === 'tint') {
    const pct = Math.round(value * 8);
    return `${pct > 0 ? '+' : ''}${pct}%`;
  }
  if (key === 'colour') {
    if (value === -2) return 'Mono';
    const pct = Math.round(value * 20);
    return `${pct > 0 ? '+' : ''}${pct}%`;
  }
  const scaled = Math.round(value * 50);
  return `${scaled > 0 ? '+' : ''}${scaled}`;
}

/** Summarises exact slider changes between two recipes so Auto suggestions are completely transparent. */
export function computeEditDeltas(before: PhotoEdit, after: PhotoEdit): EditDelta[] {
  const deltas: EditDelta[] = [];
  for (const { key, label } of ALL_NUMERIC_LABELS) {
    const prev = (before[key] as number | undefined) ?? 0;
    const next = (after[key] as number | undefined) ?? 0;
    if (Math.abs(next - prev) < 0.005) continue;
    deltas.push({
      key: String(key),
      label,
      beforeText: formatValue(key, prev),
      afterText: formatValue(key, next),
    });
  }
  const beforeCurve = before.toneCurve?.length ?? 0;
  const afterCurve = after.toneCurve?.length ?? 0;
  if (afterCurve >= 2 && afterCurve !== beforeCurve) {
    deltas.push({
      key: 'toneCurve',
      label: 'Tone curve',
      beforeText: beforeCurve >= 2 ? 'Custom' : 'Linear',
      afterText: 'Filmic S-curve',
    });
  }
  const beforeMasks = before.masks?.length ?? 0;
  const afterMasks = after.masks?.length ?? 0;
  if (afterMasks > beforeMasks) {
    deltas.push({
      key: 'subjectMask',
      label: 'Subject mask',
      beforeText: String(beforeMasks),
      afterText: `${afterMasks} (+${afterMasks - beforeMasks})`,
    });
  }
  return deltas;
}
