import type { StackRefusal, StackSource, StackSuccess, StackWarning } from '../../core/focusStack';
import { MAX_STACK_FRAMES, MIN_STACK_FRAMES } from '../../core/focusStack';
import { fullResolutionRasterFormat, isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import { stackText } from '../../i18n/areas/stack';
import { previewKey, previewOn } from '../../core/previewFeatures';

/**
 * Focus stacking in V2: everything between the editor's chosen photos and the pure stacker (src/core/focusStack.ts).
 * The result is a NEW photo (a lossless 16-bit PNG added to the project like an import) that carries a recipe of its
 * sources; the originals are only ever read.
 */

/** This device's own preview switch (Settings → Preview features); the registry is src/core/previewFeatures.ts. */
export const FOCUS_STACK_PREVIEW_KEY = previewKey('focusStack');

export function focusStackPreviewOn(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  return previewOn('focusStack', storage);
}

/** The chosen frames in shooting order (focus brackets are aligned neighbour to neighbour), or why they cannot be stacked. */
export function stackSelection(frames: readonly PhotoFrame[], photoIds: readonly string[]):
  { ok: true; frames: PhotoFrame[] } | { ok: false; message: string } {
  const chosen = new Set(photoIds);
  const picked = frames.filter((frame) => chosen.has(frame.id) && frame.removedAt == null && !frame.isDemo)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  if (picked.length < MIN_STACK_FRAMES) return { ok: false, message: stackText.tooFew };
  if (picked.length > MAX_STACK_FRAMES) return { ok: false, message: stackText.tooMany(MAX_STACK_FRAMES) };
  for (const frame of picked) {
    if (isHeifFile(frame.filename) || (!fullResolutionRasterFormat(frame.filename) && !isRawPreviewFile(frame.filename))) {
      return { ok: false, message: stackText.unsupported(frame.filename) };
    }
  }
  return { ok: true, frames: picked };
}

/** `heron_0012.jpg` + 5 frames → `heron_0012-stack5.png`. Never the name of a source. */
export function stackedFilename(first: string, count: number, taken: ReadonlySet<string> = new Set()): string {
  const base = first.replace(/\.[^.]+$/, '') || 'photo';
  let name = `${base}-stack${count}.png`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-stack${count}-${i}.png`;
  return name;
}

export function refusalText(refusal: StackRefusal): string {
  const n = refusal.frameNumber ?? 1;
  switch (refusal.reason) {
    case 'too-few': return stackText.tooFew;
    case 'too-many': return stackText.tooMany(MAX_STACK_FRAMES);
    case 'size-mismatch': return stackText.sizeMismatch;
    case 'unrelated': return stackText.unrelated(n);
    case 'ambiguous': return stackText.ambiguous(n);
    case 'too-flat': return stackText.tooFlat(n);
  }
}

export function warningText(warning: StackWarning): string {
  const n = (warning.frameIndex ?? 0) + 1;
  switch (warning.code) {
    case 'equally-sharp': return stackText.equallySharp;
    case 'frame-unused': return stackText.frameUnused(n);
    case 'one-frame-dominates': return stackText.oneFrameDominates;
    case 'local-fallback': return stackText.localFallback(n);
  }
}

/** One notice for a finished stack: what was added, then at most two calm warnings. */
export function stackDoneNotice(name: string, result: Pick<StackSuccess, 'warnings'>, count: number): string {
  const extra = result.warnings.filter((w) => w.code !== 'local-fallback').slice(0, 2).map(warningText);
  return [stackText.done(name, count), ...extra].join(' ');
}

/** Rows read from a decoded picture through a small canvas band, so the whole picture never sits in JavaScript memory. */
export function imageStackSource(image: CanvasImageSource & { naturalWidth: number; naturalHeight: number }): StackSource {
  const width = image.naturalWidth, height = image.naturalHeight;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  return {
    width, height, bits: 8,
    readRows: (y0, rows) => {
      if (!canvas) {
        canvas = document.createElement('canvas');
        context = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!context) throw new Error('Canvas unavailable');
      if (canvas.width !== width || canvas.height !== rows) { canvas.width = width; canvas.height = rows; }
      context.clearRect(0, 0, width, rows);
      context.drawImage(image, 0, y0, width, rows, 0, 0, width, rows);
      return context.getImageData(0, 0, width, rows).data;
    },
  };
}

/** The stack's RGBA16 as the RGB16 the PNG writer takes. */
export function rgbaToRgb16(result: Pick<StackSuccess, 'width' | 'height' | 'data'>): { width: number; height: number; data: Uint16Array } {
  const n = result.width * result.height;
  const data = new Uint16Array(n * 3);
  for (let i = 0; i < n; i++) { data[i * 3] = result.data[i * 4]; data[i * 3 + 1] = result.data[i * 4 + 1]; data[i * 3 + 2] = result.data[i * 4 + 2]; }
  return { width: result.width, height: result.height, data };
}
