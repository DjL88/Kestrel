import { applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { superviseAutoRender } from '../../core/autoRenderSupervisor';
import { fullContext, maskAlpha } from '../../core/masks';
import type { Mask } from '../../core/maskTypes';
import type { PhotoEdit } from '../../core/photoEdits';

export interface AutoCandidate {
  id: 'natural' | 'balanced' | 'subject';
  edit: PhotoEdit;
  summary: string;
  after: string;
}

/** Reject near-identical comparisons, including differences caused only by rounding. */
export function visiblyDifferent(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length || !a.length) return false;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) >= 3) changed++;
  }
  return changed >= Math.max(1, a.length / 4 * 0.015);
}

/** A compact comparison using the workspace's real render path, including masks. */
export function renderAutoCandidates(
  source: HTMLCanvasElement, base: PhotoEdit, recipes: readonly Omit<AutoCandidate, 'after'>[], subjects: readonly Mask[] = [],
): { before: string; candidates: AutoCandidate[]; rejected: string[] } {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 240 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { before: '', candidates: [], rejected: ['Preview renderer unavailable'] };
  const render = (edit: PhotoEdit) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    applyCanvasPhotoEdit(canvas, edit);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  // Validate the actual canvas renderer at the analysis resolution first.
  canvas.width = source.width;
  canvas.height = source.height;
  const referenceFull = render(base);
  const alpha = subjects.map(mask => maskAlpha(mask, canvas.width, canvas.height, fullContext(canvas.width, canvas.height)));
  const rejected: string[] = [];
  const safe = recipes.filter(recipe => {
    const pixels = render(recipe.edit);
    const review = superviseAutoRender({data: referenceFull,width: canvas.width,height: canvas.height}, {data: pixels,width: canvas.width,height: canvas.height}, alpha);
    if (!review.safe) rejected.push(review.reason);
    return review.safe;
  });
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const reference = render(base);
  const before = canvas.toDataURL('image/jpeg', 0.85);
  const previous = [reference];
  const candidates: AutoCandidate[] = [];
  for (const recipe of safe) {
    const pixels = render(recipe.edit);
    if (!previous.every((other) => visiblyDifferent(other, pixels))) continue;
    previous.push(pixels);
    candidates.push({ ...recipe, after: canvas.toDataURL('image/jpeg', 0.85) });
  }
  return { before, candidates, rejected };
}
