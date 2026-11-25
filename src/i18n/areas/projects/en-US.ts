import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: spelling and wording only. */
export const enUS: AreaTranslation<typeof source> = {
  wizard: {
    autoCullHint: 'After import, a cancelable local task reviews your photos while you browse. Best picks with high confidence and exact duplicates are sorted automatically; uncertain photos stay for review. Originals are untouched.',
  },
  storage: {
    declined: 'The browser did not grant persistent storage. Keep a current catalog backup.',
  },
  licence: {
    licenceKey: 'License key',
    planProKey: 'InFlight Pro is active on this device through your license key.',
    planChecking: 'Checking the license on this device…',
    copyBody: 'Your shortcuts, macro pad, display choices, export presets and watermark. Not your photos, edits, license or any keys.',
  },
  macroPad: {
    remapKnob: (command, anticlockwise, keys) => `Remap ${command} (knob ${anticlockwise ? 'counterclockwise' : 'clockwise'}, currently ${keys})`,
  },
};
