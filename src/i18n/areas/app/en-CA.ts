import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Canadian English: British spellings (catalogue, colour) with -yze verbs. Only what differs. */
export const enCA: AreaTranslation<typeof source> = {
  tasks: {
    analysedWithAdjustments: (count) => `${count} photos analyzed with usable adjustments`,
  },
  confirm: {
    autoAdjustSelected: {
      confirm: 'Analyze selected photos',
    },
    autoAdjustKeepers: {
      what: 'Kestrel will analyze each unedited keeper locally and adjust its light, colour and tone. Already edited photos stay unchanged.',
    },
  },
};
