import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Canadian English keeps British "colour", "catalogue" and "favourite", and spells "analyze" with a z. */
export const enCA: AreaTranslation<typeof source> = {
  filmstrip: {
    autoCull: 'Auto pick & Analyze',
    autoCullRunning: 'Analyzing…',
    tileStates: { analysing: 'Analyzing' },
  },
  bursts: {
    flagBestNotRanked: 'Not ranked yet. Run Auto pick & Analyze to find the best frame.',
  },
};
