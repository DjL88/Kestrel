import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  title: 'Kontroller av denne redigeringen',
  checkedDevice: 'Kontrollert på denne enheten',
  checkedCloud: 'Også kontrollert i skyen',
  review: 'Beholdt for din gjennomgang',
  unchecked: 'Ikke kontrollert',
};
