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

/** Indices of the subjects to keep when several detections describe the same animal (a tile seam, or a bird and its
 * body part). A subject is dropped when most of the smaller one lies inside the other (overlap over the smaller area at
 * least `containment`). The higher-scoring subject wins; two separate birds, which barely overlap, both stay. */
export function distinctSubjectIndices(subjects: readonly SubjectMask[], scores: readonly number[], aspect: number, containment = 0.6): number[] {
  const w = 128, h = Math.max(8, Math.round(128 * Math.min(1, Number.isFinite(aspect) && aspect > 0 ? aspect : 1)));
  const context = { ...fullContext(w, h), aspect };
  const alphas = subjects.map(subject => maskAlpha(subject, w, h, context));
  const areas = alphas.map(alpha => alpha.reduce((sum, v) => sum + (v >= 0.5 ? 1 : 0), 0));
  const order = subjects.map((_, i) => i).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const kept: number[] = [];
  for (const i of order) {
    const duplicate = kept.some(k => {
      let both = 0;
      for (let p = 0; p < alphas[i].length; p++) if (alphas[i][p] >= 0.5 && alphas[k][p] >= 0.5) both++;
      const smaller = Math.min(areas[i], areas[k]);
      return smaller > 0 && both / smaller >= containment;
    });
    if (!duplicate) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}
