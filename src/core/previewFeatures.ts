import type { Feature } from './features';

/**
 * Every device-local preview switch, in one place. A preview is a feature that is still being proven, so it is off
 * unless this device's switch is on (or an admin flag turns it on for everyone). The switch is a string in this
 * device's local storage; nothing is sent anywhere. Each feature's own reader (`workflowPreviewOn`, `hdrPreviewOn`,
 * and so on) goes through `previewOn` here, so Settings → Preview features and the app always agree.
 *
 * Keys and defaults are part of what people have already set on their devices: never rename a key, and never turn a
 * preview on by default here (that is a deliberate change to `FEATURES` in features.ts or an admin flag).
 */
export interface PreviewFeature {
  id: string;
  /** The localStorage key. Set to '1' for on; anything else (or nothing) is off. */
  storageKey: string;
  /** The preview's plain-words name and its one honest line, as keys of `previewText` (src/i18n/areas/preview). */
  nameKey: string;
  descriptionKey: string;
  /** True when the app only reads the switch once at start-up, so a change shows after a restart. */
  needsRestart: boolean;
  /** The admin-controlled feature this switch sits beside, when there is one. */
  feature?: Feature;
}

const preview = (id: string, storageKey: string, needsRestart = false, feature?: Feature): PreviewFeature =>
  ({ id, storageKey, nameKey: `${id}Name`, descriptionKey: `${id}Desc`, needsRestart, ...(feature ? { feature } : {}) });

export const PREVIEW_FEATURES = [
  preview('onImageAdvice', 'kestrel.preview.on-image-advice.v1', false, 'onImageAdvice'),
  preview('finishBest', 'kestrel.preview.finish-best.v1', false, 'finishBest'),
  preview('flightBatch', 'kestrel.preview.flight-batch.v1', false, 'flightBatch'),
  preview('cullRules', 'kestrel.preview.cull-rules.v1', false, 'cullRules'),
  preview('cullMaskSharpness', 'kestrel.preview.cullMaskSharpness.v1'),
  preview('enhanceLoop', 'kestrel.preview.enhance-loop.v1'),
  preview('cloudRecipe', 'kestrel.preview.cloudRecipe.v1', false, 'cloudRecipe'),
  preview('verificationChain', 'kestrel.preview.verification-chain.v1', false, 'verificationChain'),
  preview('cloudOriginals', 'kestrel.preview.cloud-originals.v1'),
  preview('phoneTwoPages', 'kestrel.preview.phone-two-pages.v1'),
  preview('tapForPhoto', 'kestrel.preview.tap-for-photo.v1'),
  preview('usbTether', 'kestrel.preview.usb-tether.v1'),
  preview('ortWebgpu', 'kestrel.preview.ort-webgpu.v1', true),
  // On for everyone since 26 Nov 2026 (see FEATURES). Their switches still exist, so Settings shows them as on.
  preview('focusStack', 'kestrel.preview.focus-stack.v1', false, 'focusStack'),
  preview('panorama', 'kestrel.preview.panorama.v1', false, 'panorama'),
  preview('hdrMerge', 'kestrel.preview.hdr-merge.v1', false, 'hdrMerge'),
  preview('savedViews', 'kestrel.preview.saved-views.v1', false, 'savedViews'),
  preview('nextToReview', 'kestrel.preview.next-to-review.v1', false, 'nextToReview'),
  preview('brandKits', 'kestrel.preview.brand-kits.v1', false, 'brandKits'),
  preview('editStyle', 'kestrel.preview.edit-style.v1', false, 'editStyle'),
  preview('cullWarmup', 'kestrel.preview.cullWarmup.v1', false, 'cullWarmup'),
] as const;

export type PreviewId = (typeof PREVIEW_FEATURES)[number]['id'];

const BY_ID = new Map<string, PreviewFeature>(PREVIEW_FEATURES.map((item) => [item.id, item]));

export function previewFeature(id: PreviewId): PreviewFeature {
  return BY_ID.get(id) as PreviewFeature;
}

export const previewKey = (id: PreviewId): string => previewFeature(id).storageKey;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem' | 'removeItem'>;
const deviceStorage = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

/** Is this preview's switch on for this device? Unreadable storage counts as off. */
export function previewOn(id: PreviewId, storage: Reader | null | undefined = deviceStorage()): boolean {
  try { return storage?.getItem(previewKey(id)) === '1'; } catch { return false; }
}

let version = 0;
const listeners = new Set<() => void>();

/** Changes whenever a switch is written here, so screens that read a preview while drawing can redraw. */
export const previewsVersion = (): number => version;

export function subscribePreviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Turn a preview on or off for this device. Off removes the key, so the device is back to its default. Returns false
 * when storage refused the write (private browsing, full or blocked storage): the switch has not changed.
 */
export function setPreview(id: PreviewId, on: boolean, storage: (Reader & Writer) | null | undefined = deviceStorage()): boolean {
  try {
    if (!storage) return false;
    if (on) storage.setItem(previewKey(id), '1'); else storage.removeItem(previewKey(id));
    if ((storage.getItem(previewKey(id)) === '1') !== on) return false;
  } catch { return false; }
  version += 1;
  for (const listener of [...listeners]) { try { listener(); } catch { /* one listener must not stop the rest */ } }
  return true;
}
