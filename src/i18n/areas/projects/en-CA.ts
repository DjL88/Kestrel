import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Canadian English keeps British spellings such as "licence" and "catalogue"; only "counterclockwise" differs here. */
export const enCA: AreaTranslation<typeof source> = {
  macroPad: {
    remapKnob: (command, anticlockwise, keys) => `Remap ${command} (knob ${anticlockwise ? 'counterclockwise' : 'clockwise'}, currently ${keys})`,
  },
};
