import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  title: 'Tämän muokkauksen tarkistukset',
  checkedDevice: 'Tarkistettu tällä laitteella',
  checkedCloud: 'Tarkistettu myös pilvessä',
  review: 'Säilytetty tarkistettavaksi',
  unchecked: 'Ei tarkistettu',
};
