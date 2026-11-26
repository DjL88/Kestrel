/**
 * This device's own preview switches for the small workflow extras (Settings has none yet). Each is off unless
 * `localStorage['kestrel.preview.<name>.v1'] = '1'`; an admin flag can also turn the feature on. Nothing is sent anywhere.
 */
export const WORKFLOW_PREVIEW_KEYS = {
  savedViews: 'kestrel.preview.saved-views.v1',
  nextToReview: 'kestrel.preview.next-to-review.v1',
  /** Culling from stored observations and the Culling Assistant's rule sliders (x-std-rescore, x-std-cull-rules). */
  cullRules: 'kestrel.preview.cull-rules.v1',
} as const;

export type WorkflowPreview = keyof typeof WORKFLOW_PREVIEW_KEYS;

export function workflowPreviewOn(name: WorkflowPreview, storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { return storage?.getItem(WORKFLOW_PREVIEW_KEYS[name]) === '1'; } catch { return false; }
}
