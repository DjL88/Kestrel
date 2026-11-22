/** Labels for the unified Auto control. British English is the source; other languages fall back to it until translated. */
const en = {
  auto: 'Auto',
  analysing: 'Analysing…',
  hint: 'Measures this photo on this device and applies one reversible edit.',
  strength: 'Strength',
  strengthValue: (percent: number) => `${percent}%`,
  undo: 'Undo Auto',
  apply: 'Apply',
  keep: 'Keep current',
  compare: 'Compare',
  hideCompare: 'Hide comparison',
  region: 'Auto',
  more: 'What was measured',
  vision: 'On-device description',
  visionNote: 'Only a description. It never sets a slider.',
  verdict: { improved: 'Improved', 'looks-good': 'Looks good', 'cannot-improve-safely': 'Cannot improve safely' } as Record<string, string>,
  installingModel: 'Installing the species model for Auto',
  modelInstalled: 'Species model installed. Auto will use it from the next press.',
  undone: 'Auto undone. Your look is exactly as it was.',
  stale: 'You have edited the photo since Auto ran. Press Auto again to measure afresh.',
};
export type AutoLabels = typeof en;
export const autoLabels: AutoLabels = en;
