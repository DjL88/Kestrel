import { formatUploadSize, parseCloudRecipe, planRecipeUpload, recipeIsEmpty, CLOUD_RECIPE_PREVIEW_EDGE,
  type CloudRecipe, type FullFileConsent, type RecipeUploadOption, type RecipeUploadPlan, type TransferEstimate } from '../../core/cloudRecipe';
import type { EditWhy } from '../../core/editHistory';
import type { PhotoEdit } from '../../core/photoEdits';
import type { PhotoFrame } from '../../core/types';
import type { CloudRecipeService } from '../../providers/cloudRecipeService';
import { applyRecipePatch } from './recipeMap';

/**
 * Cloud edit settings for one photo (x-std-cloud-recipe), in two steps the person sees:
 * 1. `prepareCloudRecipe` works out what would be sent and its size. Nothing leaves the device.
 * 2. `sendCloudRecipe` runs only after the person presses Send on that offer. It uploads exactly the picture shown,
 *    reads back the edit settings and checks them. The caller applies them with `cloudRecipeEdit` as one undoable step.
 */
export interface RecipeSources {
  /** The 2,560 px smart preview on this device, or null (web, phone, or a picture file). */
  smartPreview(frame: PhotoFrame): Promise<Blob | null>;
  /** The original, read from its drive if needed. Read only when the full-file opt-in is on. */
  ensureOriginal(stableKey: string, priority?: 'selected'): Promise<Blob | undefined>;
}

export interface CloudRecipeOffer {
  photoId: string;
  plan: RecipeUploadPlan;
  /** What Send would upload, with its size in words, e.g. "1.4 MB smart preview". */
  sendLabel?: string;
  alternativeLabel?: string;
}

interface Prepared { offer: CloudRecipeOffer; blobs: Partial<Record<RecipeUploadOption['kind'], Blob>> }

const dimensions = (frame: Pick<PhotoFrame, 'exif'>) => ({ width: frame.exif?.width, height: frame.exif?.height });
const previewMegapixels = (frame: Pick<PhotoFrame, 'exif'>) => {
  const { width, height } = dimensions(frame);
  if (width && height && width > 0 && height > 0) {
    const scale = Math.min(1, CLOUD_RECIPE_PREVIEW_EDGE / Math.max(width, height));
    return (width * scale) * (height * scale) / 1e6;
  }
  return (CLOUD_RECIPE_PREVIEW_EDGE * CLOUD_RECIPE_PREVIEW_EDGE * 2 / 3) / 1e6;
};
const originalMegapixels = (frame: Pick<PhotoFrame, 'exif'>) => {
  const { width, height } = dimensions(frame);
  return width && height && width > 0 && height > 0 ? width * height / 1e6 : 24;
};

export const describeOption = (option: RecipeUploadOption): string =>
  `${formatUploadSize(option.bytes)} ${option.kind === 'original' ? 'full original' : 'smart preview'}`;

export async function prepareCloudRecipe(
  frame: PhotoFrame, sources: RecipeSources, fullFile: FullFileConsent, estimate: TransferEstimate = {},
): Promise<Prepared> {
  const preview = await sources.smartPreview(frame).catch(() => null);
  // The original is only read when the person has opted in to sending it, and is still not sent until they press Send.
  const original = fullFile.on ? await sources.ensureOriginal(frame.stableKey, 'selected').catch(() => undefined) : undefined;
  const plan = planRecipeUpload({
    preview: preview && preview.size > 0 ? { bytes: preview.size, megapixels: previewMegapixels(frame) } : null,
    original: original && original.size > 0 ? { bytes: original.size, megapixels: originalMegapixels(frame) } : null,
  }, fullFile, estimate);
  const blobs: Prepared['blobs'] = {};
  if (preview) blobs['smart-preview'] = preview;
  if (original) blobs.original = original;
  const offer: CloudRecipeOffer = { photoId: frame.id, plan };
  if (plan.status === 'ready') {
    offer.sendLabel = describeOption(plan.send);
    if (plan.alternative) offer.alternativeLabel = describeOption(plan.alternative);
  }
  return { offer, blobs };
}

export type CloudRecipeOutcome =
  | { status: 'ready'; recipe: CloudRecipe; sent: RecipeUploadOption }
  | { status: 'refused'; sent: RecipeUploadOption }
  | { status: 'empty'; sent: RecipeUploadOption };

/**
 * Send the option the person chose. The full original can be chosen only when the offer included it, which needs the
 * opt-in, and the opt-in is checked again here in case it was withdrawn while the offer was open.
 */
export async function sendCloudRecipe(
  prepared: Prepared, choice: 'send' | 'alternative', fullFile: FullFileConsent, service: CloudRecipeService, signal?: AbortSignal,
): Promise<CloudRecipeOutcome> {
  const { plan } = prepared.offer;
  if (plan.status !== 'ready') throw new Error('There is nothing to send for this photo.');
  const option = choice === 'alternative' ? plan.alternative : plan.send;
  if (!option) throw new Error('That choice is not available for this photo.');
  if (option.kind === 'original' && !fullFile.on) throw new Error('Sending full originals is switched off in Settings.');
  const blob = prepared.blobs[option.kind];
  if (!blob || blob.size !== option.bytes) throw new Error('The picture changed after its size was shown. Nothing was sent.');
  const answer = await service.run({ input: blob, inputKind: option.kind, userConsent: true, signal });
  const recipe = parseCloudRecipe(answer.bytes, { jobId: answer.jobId, input: option.kind });
  if (!recipe) return { status: 'refused', sent: option };
  if (recipeIsEmpty(recipe)) return { status: 'empty', sent: option };
  return { status: 'ready', recipe, sent: option };
}

/** The photo's edit with the recipe's settings in place. Everything the recipe does not name is kept as it was. */
export function cloudRecipeEdit(edit: PhotoEdit | undefined, recipe: CloudRecipe): PhotoEdit {
  return applyRecipePatch(edit, recipe.settings).edit;
}

/** Why this step is in the history, so Undo and the edit story say where it came from. */
export function cloudRecipeWhy(recipe: CloudRecipe, sent: RecipeUploadOption): EditWhy {
  const notes = [`Edit settings from a cloud job that worked on the ${describeOption(sent)}.`];
  if (recipe.producer) notes.push(`Made by ${recipe.producer.name} ${recipe.producer.version}.`);
  for (const note of recipe.notes ?? []) notes.push(note);
  return { by: 'auto', notes: notes.slice(0, 8) };
}
