import { applyCanvasPhotoEdit } from '../../core/canvasEdit';
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
  source: HTMLCanvasElement, base: PhotoEdit, recipes: readonly Omit<AutoCandidate, 'after'>[],
): { before: string; candidates: AutoCandidate[] } {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 240 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { before: '', candidates: [] };
  const render = (edit: PhotoEdit) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    applyCanvasPhotoEdit(canvas, edit);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const reference = render(base);
  const before = canvas.toDataURL('image/jpeg', 0.85);
  const previous = [reference];
  const candidates: AutoCandidate[] = [];
  for (const recipe of recipes) {
    const pixels = render(recipe.edit);
    if (!previous.every((other) => visiblyDifferent(other, pixels))) continue;
    previous.push(pixels);
    candidates.push({ ...recipe, after: canvas.toDataURL('image/jpeg', 0.85) });
  }
  return { before, candidates };
}
