import { EMPTY_STYLE, parseStyle, type EditStyle } from '../../core/editStyle';

/**
 * Where the personal editing style lives: this device's own storage, never a project file, an account or a server.
 * Every read and write is guarded, so a private window or blocked storage simply means nothing is learnt.
 */
export const EDIT_STYLE_KEY = 'kestrel.edit-style.v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): Store | null => (typeof localStorage === 'undefined' ? null : localStorage);

export function loadEditStyle(storage: Store | null = local()): EditStyle {
  try {
    const raw = storage?.getItem(EDIT_STYLE_KEY);
    return raw ? parseStyle(JSON.parse(raw)) : EMPTY_STYLE;
  } catch { return EMPTY_STYLE; }
}

export function saveEditStyle(style: EditStyle, storage: Store | null = local()): void {
  try { storage?.setItem(EDIT_STYLE_KEY, JSON.stringify(style)); } catch { /* storage full or blocked: nothing is learnt */ }
}

export function resetEditStyle(storage: Store | null = local()): void {
  try { storage?.removeItem(EDIT_STYLE_KEY); } catch { /* nothing stored */ }
}
