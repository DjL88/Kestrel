/** Crop ideas the person hid, by `photoId:formatId`, remembered on this device so a hidden idea stays hidden. */
export const CROP_DISMISSALS_KEY = 'kestrel.dismissedCropSuggestions';
const KEEP = 500;

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

export function readCropDismissals(store: Store): string[] {
  try {
    const raw = JSON.parse(store?.getItem(CROP_DISMISSALS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : [];
  } catch { return []; }
}

/** Adds one key (once) and returns the new list; storage failing leaves the list working for this session. */
export function addCropDismissal(store: Store, keys: string[], key: string): string[] {
  const next = (keys.includes(key) ? keys : [...keys, key]).slice(-KEEP);
  try { store?.setItem(CROP_DISMISSALS_KEY, JSON.stringify(next)); } catch { /* a convenience only */ }
  return next;
}
