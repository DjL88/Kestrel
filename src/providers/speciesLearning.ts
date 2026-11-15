import { recordAccepted, type SpeciesCounts } from '../core/speciesMatch';

const COUNTS_KEY = 'kestrel.speciesCounts.v1';
const AUTO_KEY = 'kestrel.autoTag.v1';

export function readSpeciesCounts(): SpeciesCounts {
  try { return JSON.parse(localStorage.getItem(COUNTS_KEY) ?? '{}') as SpeciesCounts; } catch { return {}; }
}

/** The user accepted or kept this name, so it rises a little in the order next time. Learning is a bonus, never a need. */
export function rememberSpecies(common: string): void {
  try { localStorage.setItem(COUNTS_KEY, JSON.stringify(recordAccepted(readSpeciesCounts(), common))); } catch { /* Nothing to save to. */ }
}

/** Automatic tagging is on unless the user has turned it off. */
export function readAutoTag(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; }
}

export function saveAutoTag(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch { /* The choice lasts for this visit only. */ }
}
