import { autoEnhance, studioAutoEnhance } from '../core/autoEnhance';
import { assessAutoQuality } from '../core/autoQualityGate';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { proposeSubjectAwareAuto, type InsightSubjectKind } from '../core/insightSubjectAuto';
import { analyzeSubjectKestrel } from '../core/kestrelVision';
import { framingKey } from '../core/maskTypes';
import { DEFAULT_FRAMING } from '../core/photoFraming';
import { DEFAULT_EDIT, isEmptyEdit, type PhotoEdit } from '../core/photoEdits';
import { recordEdit } from '../core/editHistory';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { loadImage } from './loadImage';

function inferSubjectKind(frame: PhotoFrame): InsightSubjectKind {
  if (frame.subjectKind === 'landscape') return 'landscape';
  if (frame.subjectKind === 'wildlife' || frame.subjectKind === 'people') return frame.subjectKind;
  const labels = [...(frame.tags ?? []), ...(frame.subjectNames ?? [])].join(' ').toLowerCase();
  if (/\b(bird|mammal|wildlife|animal|insect)\b/.test(labels)) return 'wildlife';
  if (/\b(portrait|person|people|face)\b/.test(labels)) return 'people';
  if (/\b(aircraft|airplane|aeroplane|plane|helicopter|jet)\b/.test(labels)) return 'aircraft';
  return 'other';
}

function testSuggestionQuality(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  source: Uint8ClampedArray,
  candidate: PhotoEdit,
): boolean {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  applyCanvasPhotoEdit(canvas, candidate);
  const proposed = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return assessAutoQuality(source, proposed).safe;
}

/** Preview-sized local analysis for each keeper, never uploaded or written to the original. */
export async function suggestKeeperAutoEdits(
  frames: PhotoFrame[], provider: BrowserPreviewProvider, signal: AbortSignal, onProgress: (done: number) => void,
  targetIds?: ReadonlySet<string>,
): Promise<Map<string, PhotoEdit>> {
  const candidates = frames.filter((frame) =>
    (targetIds ? targetIds.has(frame.id) : frame.decision === 'keep') && !frame.removedAt && !frame.virtualCopy &&
    !frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit)));
  const edits = new Map<string, PhotoEdit>();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Image analysis is unavailable on this device.');
  const testCanvas = document.createElement('canvas');
  const testCtx = testCanvas.getContext('2d', { willReadFrequently: true });
  if (!testCtx) throw new Error('Image analysis is unavailable on this device.');

  for (let i = 0; i < candidates.length; i += 1) {
    signal.throwIfAborted();
    const frame = candidates[i];
    try {
      const url = await provider.getFullPreviewUrl(frame);
      signal.throwIfAborted();
      if (url) {
        const image = await loadImage(url);
        signal.throwIfAborted();
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        testCanvas.width = canvas.width;
        testCanvas.height = canvas.height;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const source = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        const studio = studioAutoEnhance(source, canvas.width, canvas.height);
        let suggestion: PhotoEdit = { ...DEFAULT_EDIT, ...studio.edit };

        const category = inferSubjectKind(frame);
        if (category !== 'landscape' && canvas.width >= 8 && canvas.height >= 8) {
          const vision = analyzeSubjectKestrel(source, canvas.width, canvas.height);
          if (vision.assessment.usable) {
            const effectiveKind: InsightSubjectKind =
              category !== 'other' ? category : vision.category === 'landscape' ? 'landscape' : vision.category;
            const local = proposeSubjectAwareAuto({
              pixels: source,
              width: canvas.width,
              height: canvas.height,
              edit: suggestion,
              subjectKind: effectiveKind,
              segmentation: { grid: vision.grid, confidence: vision.assessment.confidence },
              maskId: `auto-subject-${frame.id.slice(0, 8)}`,
              framingKey: framingKey(frame.framing ?? DEFAULT_FRAMING),
            });
            if (local.usedMask) suggestion = local.edit;
          }
        }

        if (!isEmptyEdit(suggestion) && testSuggestionQuality(testCtx, testCanvas, image, source, suggestion)) {
          edits.set(frame.id, suggestion);
        } else {
          // Graceful fallback to conservative base histogram autoEnhance without masks/clarity
          const base = autoEnhance(source);
          const fallback: PhotoEdit = { ...DEFAULT_EDIT, ...base.edit };
          if (!isEmptyEdit(fallback) && testSuggestionQuality(testCtx, testCanvas, image, source, fallback)) {
            edits.set(frame.id, fallback);
          }
        }
      }
    } catch {
      signal.throwIfAborted();
      // One damaged or unavailable preview must not block the other keepers.
    }
    onProgress(i + 1);
    // Let the interface repaint and the user cancel between photographs.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return edits;
}

/** Stale scan results cannot overwrite an existing edit, a changed decision or a removed photograph. */
export function applyKeeperAutoEdits(
  frames: PhotoFrame[], edits: ReadonlyMap<string, PhotoEdit>, at: number, targetIds?: ReadonlySet<string>,
): PhotoFrame[] {
  return frames.map((frame) => {
    const suggested = edits.get(frame.id);
    if (!suggested || !(targetIds ? targetIds.has(frame.id) : frame.decision === 'keep') || frame.removedAt || frame.virtualCopy ||
        frame.editHistory?.steps.length || (frame.edit && !isEmptyEdit(frame.edit))) return frame;
    return recordEdit(frame, { edit: suggested }, at);
  });
}
