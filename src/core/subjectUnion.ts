import { maskAlpha, fullContext } from './masks';
import type { Mask, SubjectGrid } from './maskTypes';

type SubjectMask = Extract<Mask, { kind: 'subject' }>;

/** Rasterise existing subject coverage in the same framed coordinates.
 * Max coverage (not sum) prevents double protection where subjects overlap.
 * Encode the inverse of the standard feather curve for a normal subject grid.
 */
export function unionSubjectGrid(subjects: readonly SubjectMask[], aspect: number): SubjectGrid {
  if (!subjects.length || !Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Missing subject coverage');
  const w = Math.max(8, Math.round(512 / Math.max(1, aspect)));
  const h = Math.max(8, Math.round(512 * Math.min(1, aspect)));
  const union = new Float32Array(w * h);
  for (const subject of subjects) {
    const alpha = maskAlpha(subject, w, h, { ...fullContext(w, h), aspect });
    for (let i = 0; i < union.length; i++) union[i] = Math.max(union[i], alpha[i]);
  }
  let binary = '';
  for (const value of union) {
    if (value <= 0) { binary += String.fromCharCode(0); continue; }
    if (value >= 1) { binary += String.fromCharCode(255); continue; }
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) {
      const t = (lo + hi) / 2;
      if (t * t * (3 - 2 * t) < value) lo = t; else hi = t;
    }
    // Standard subject feather 0.5 gives threshold range 0.26..0.74.
    binary += String.fromCharCode(Math.round(255 * (0.26 + 0.48 * (lo + hi) / 2)));
  }
  return { w, h, data: btoa(binary) };
}
