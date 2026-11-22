/**
 * The switch for the Version 2 workspace. While it is built, the current Library and Editor stay the default.
 * `?v2` (or `?v2=1`) turns it on and remembers that on this device; `?v2=0` turns it off again.
 */
export const V2_STORAGE_KEY = 'inflight.v2';

export function resolveV2Switch(search: string, stored: string | null): { enabled: boolean; remember: 'on' | 'off' | null } {
  const params = new URLSearchParams(search);
  if (params.has('v2')) {
    const value = params.get('v2');
    const off = value === '0' || value === 'false' || value === 'off';
    return { enabled: !off, remember: off ? 'off' : 'on' };
  }
  return { enabled: stored === 'on', remember: null };
}

export function v2Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(V2_STORAGE_KEY); } catch { /* private storage: the switch still works from the address */ }
  const result = resolveV2Switch(window.location.search, stored);
  if (result.remember) {
    try { window.localStorage.setItem(V2_STORAGE_KEY, result.remember); } catch { /* optional */ }
  }
  return result.enabled;
}

/** Leaves (or re-enters) the Version 2 workspace without a reload, and remembers the choice on this device. */
export function rememberV2(on: boolean): void {
  try { window.localStorage.setItem(V2_STORAGE_KEY, on ? 'on' : 'off'); } catch { /* optional */ }
}
