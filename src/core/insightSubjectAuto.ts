import type { PhotoEdit } from './photoEdits';
import type { LocalEdit, Mask, SubjectDetail, SubjectGrid } from './maskTypes';

/**
 * InFlight Insight research: a conservative, offline subject-aware Auto proposal.
 *
 * Operates on an unedited, framed preview and existing segmentation result.
 * It NEVER commits an edit: the caller must show a before/after preview and
 * request explicit acceptance. Does not fetch a model or upload photos.
 */
export type InsightSubjectKind = 'wildlife' | 'people' | 'aircraft' | 'landscape' | 'other';
export interface SubjectAutoInput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Current prospective global recipe (not a saved edit). */
  edit: PhotoEdit;
  subjectKind: InsightSubjectKind;
  /** `detail` is the fine, edge-refined outline; it only changes how the saved mask's edge is drawn. */
  segmentation?: { grid: SubjectGrid; confidence: 'high' | 'medium' | 'low'; detail?: SubjectDetail | null } | null;
  framingKey: string;
  /** Distinct ID for the prospective mask, supplied by the caller. */
  maskId: string;
  /**
   * Extra local adjustments measured by Natural Auto (dark feather recovery, a light subject-only sharpen).
   * Used only once every mask check below has passed, so an untrustworthy mask never carries them.
   */
  extra?: LocalEdit | null;
}
export interface SubjectAutoProposal {
  edit: PhotoEdit;
  usedMask: boolean;
  reason: string;
}
const fallback = (edit: PhotoEdit, reason: string): SubjectAutoProposal => ({ edit, usedMask: false, reason });
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Propose one gentle subject lift only when a trustworthy segmented subject
 * is visibly darker than its surroundings. This is not species recognition.
 * A low-confidence, oversized, empty, too-bright or malformed mask is rejected.
 * Current user masks are never replaced, and no detail/sharpening is invented.
 */
export function proposeSubjectAwareAuto(input: SubjectAutoInput): SubjectAutoProposal {
  const { pixels, width, height, edit, segmentation, subjectKind, maskId, framingKey } = input;
  const extra = Object.fromEntries(Object.entries(input.extra ?? {}).filter(([, v]) => Number.isFinite(v) && v !== 0)) as LocalEdit;
  const hasExtra = Object.keys(extra).length > 0;
  if (!segmentation || segmentation.confidence === 'low' || subjectKind === 'landscape') {
    return fallback(edit, 'No reliable isolated subject: keep the global suggestion.');
  }
  // For unclassified photographs, only a high-confidence, isolated subject is safe enough.
  if (subjectKind === 'other' && segmentation.confidence !== 'high') {
    return fallback(edit, 'Subject classification is uncertain; no automatic local adjustment.');
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 8 || height < 8 || width > 2048 || height > 2048 ||
      pixels.length !== width * height * 4) {
    return fallback(edit, 'Preview was unavailable for local subject assessment.');
  }
  if (!maskId || !framingKey || framingKey.length > 80 ||
      (edit.masks?.length ?? 0) >= 12 || edit.masks?.some((mask) => mask.id === maskId)) {
    return fallback(edit, 'Existing adjustments are preserved without adding a new mask.');
  }
  const { w, h, data } = segmentation.grid;
  if (!Number.isInteger(w) || !Number.isInteger(h) ||
      w < 8 || h < 8 || w > 512 || h > 512 || typeof data !== 'string' ||
      data.length !== Math.ceil(w * h / 3) * 4) {
    return fallback(edit, 'Subject mask dimensions were not reliable.');
  }
  let decoded: string;
  try { decoded = atob(data); } catch {
    return fallback(edit, 'Subject mask could not be decoded.');
  }
  if (decoded.length !== w * h) return fallback(edit, 'Subject mask was incomplete.');
  let subjectTotal = 0, backgroundTotal = 0, subjectCount = 0, backgroundCount = 0, clipped = 0;
  for (let y = 0; y < height; y++) {
    const gy = Math.min(h - 1, Math.floor(y * h / height));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] !== 255) continue;
      const gx = Math.min(w - 1, Math.floor(x * w / width));
      const confidenceByte = decoded.charCodeAt(gy * w + gx);
      const value = luma(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (confidenceByte >= 200) {
        subjectTotal += value;
        subjectCount += 1;
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) >= 251) clipped += 1;
      } else if (confidenceByte <= 55) {
        backgroundTotal += value;
        backgroundCount += 1;
      }
    }
  }
  const total = width * height;
  const coverage = subjectCount / total;
  if (coverage < (subjectKind === 'other' ? 0.07 : 0.05) ||
      coverage > (subjectKind === 'other' ? 0.45 : 0.7) ||
      subjectCount < 16 || backgroundCount < Math.max(16, total * 0.15)) {
    return fallback(edit, 'Subject boundaries were uncertain; no local adjustment was suggested.');
  }
  const subjectLuma = subjectTotal / subjectCount;
  const backgroundLuma = backgroundTotal / backgroundCount;
  const difference = backgroundLuma - subjectLuma;
  const subjectMask = (local: LocalEdit): Mask => ({
    id: maskId, kind: 'subject', grid: segmentation.grid, framingKey, confidence: segmentation.confidence,
    strokes: [], invert: false, feather: 0.55, edit: local, ...(segmentation.detail ? { detail: segmentation.detail } : {}),
  });
  if (difference < (subjectKind === 'other' ? 0.23 : segmentation.confidence === 'high' ? 0.12 : 0.18) ||
      subjectLuma > 0.72 || clipped / subjectCount > 0.03) {
    if (hasExtra) {
      return {
        edit: { ...edit, masks: [...(edit.masks ?? []), subjectMask(extra)] },
        usedMask: true,
        reason: 'A gentle local adjustment on the subject only. The background is not changed.',
      };
    }
    return fallback(edit, 'Subject exposure does not need a separate lift.');
  }
  // Old recipe scale: 1 unit is 0.4 EV. Keep this first-step suggestion gentle;
  // no extra sharpening or hallucinated subject texture is introduced.
  const localExposure = Math.min(0.6, Math.max(0.15, Math.round(difference * 1.2 * 20) / 20));
  const mask = subjectMask({ ...extra, exposure: localExposure });
  return {
    edit: { ...edit, masks: [...(edit.masks ?? []), mask] },
    usedMask: true,
    reason: 'The subject is darker than its surroundings. Preview a gentle local lift without changing the background.',
  };
}
