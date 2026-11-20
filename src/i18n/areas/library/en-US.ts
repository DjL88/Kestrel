import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: spelling only. "Trash" stays as it is. */
export const enUS: AreaTranslation<typeof source> = {
  tasks: { cancelled: 'Canceled' },
};
