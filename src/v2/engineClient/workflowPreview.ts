/**
 * This device's own preview switches for the small workflow extras (Settings has none yet). Each is off unless
 * `localStorage['kestrel.preview.<name>.v1'] = '1'`; an admin flag can also turn the feature on. Nothing is sent anywhere.
 */
export const WORKFLOW_PREVIEW_KEYS = {
  savedViews: 'kestrel.preview.saved-views.v1',
  nextToReview: 'kestrel.preview.next-to-review.v1',
  /** Culling from stored observations and the Culling Assistant's rule sliders (x-std-rescore, x-std-cull-rules). */
  cullRules: 'kestrel.preview.cull-rules.v1',
  /** Brand kits in the export dialog (x-workflow-brand, K080). */
  brandKits: 'kestrel.preview.brand-kits.v1',
  /** Auto leans towards the edits this person keeps, undoes or corrects, learnt on this device (x-spec-personal-style). */
  editStyle: 'kestrel.preview.edit-style.v1',
  /** Auto-pilot edits the photos of a new import in the background, best first (src/core/flightModes.ts planAutoBatch). */
  flightBatch: 'kestrel.preview.flight-batch.v1',
  /** Tethered shooting over USB in the desktop app (PTP), until it is proven on real cameras. */
  /** Finish my best: one batch that edits the best photos first, then a review (Finish best…, top of the photo strip). */
  finishBest: 'kestrel.preview.finish-best.v1',
  /** Store the full original in the cloud with each chosen photo (lossless on another device), until proven with a real account. */
  cloudOriginals: 'kestrel.preview.cloud-originals.v1',
  usbTether: 'kestrel.preview.usb-tether.v1',
  /** The phone's two pages (photo grid, then one-photo editor, no filmstrip). Always on in the phone app shell; here for a browser. */
  phoneTwoPages: 'kestrel.preview.phone-two-pages.v1',
  /** Hatched clipping, focus point and the Colour Sense badge drawn on the canvas (read-only advice). */
  onImageAdvice: 'kestrel.preview.on-image-advice.v1',
  /** Verification chain: specialist proposes, this device confirms, cloud is a quiet third opinion on previews (src/core/verificationTrail.ts). */
  verificationChain: 'kestrel.preview.verification-chain.v1',
} as const;

export type WorkflowPreview = keyof typeof WORKFLOW_PREVIEW_KEYS;

export function workflowPreviewOn(name: WorkflowPreview, storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { return storage?.getItem(WORKFLOW_PREVIEW_KEYS[name]) === '1'; } catch { return false; }
}
