import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  title: 'Prüfungen dieser Bearbeitung',
  checkedDevice: 'Auf diesem Gerät geprüft',
  checkedCloud: 'Auch in der Cloud geprüft',
  review: 'Zur Durchsicht aufbewahrt',
  unchecked: 'Nicht geprüft',
};
