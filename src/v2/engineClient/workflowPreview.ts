import { previewKey, previewOn, type PreviewId } from '../../core/previewFeatures';

/**
 * This device's own preview switches for the small workflow extras. They are turned on in Settings → Preview features
 * (the registry is src/core/previewFeatures.ts); each is off unless its switch is on, and an admin flag can also turn
 * the feature on. Nothing is sent anywhere. The keys below are the registry's, kept for the tests and older callers.
 */
export const WORKFLOW_PREVIEW_KEYS = {
  savedViews: previewKey('savedViews'),
  nextToReview: previewKey('nextToReview'),
  /** Culling from stored observations and the Culling Assistant's rule sliders (x-std-rescore, x-std-cull-rules). */
  cullRules: previewKey('cullRules'),
  /** Brand kits in the export dialog (x-workflow-brand, K080). */
  brandKits: previewKey('brandKits'),
  /** Auto leans towards the edits this person keeps, undoes or corrects, learnt on this device (x-spec-personal-style). */
  editStyle: previewKey('editStyle'),
  /** Auto-pilot edits the photos of a new import in the background, best first (src/core/flightModes.ts planAutoBatch). */
  flightBatch: previewKey('flightBatch'),
  /** Tethered shooting over USB in the desktop app (PTP), until it is proven on real cameras. */
  usbTether: previewKey('usbTether'),
  /** Hatched clipping, focus point and the Colour Sense badge drawn on the canvas (read-only advice). */
  onImageAdvice: previewKey('onImageAdvice'),
} satisfies Partial<Record<PreviewId, string>>;

export type WorkflowPreview = keyof typeof WORKFLOW_PREVIEW_KEYS;

export function workflowPreviewOn(name: WorkflowPreview, storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  return previewOn(name, storage);
}
