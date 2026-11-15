import { parsePresets, type Preset } from '../core/presets';

const KEY = 'kestrel-presets-v1';

export function loadPresets(): Preset[] {
  try {
    return parsePresets(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function savePresets(list: Preset[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(({ id, name, edit }) => ({ id, name, edit }))));
    return true;
  } catch {
    return false;
  }
}
