import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only the words spelled differently. */
export const enUS: AreaTranslation<typeof source> = {
  overlay: { centre: 'Center' },
  watermark: { positions: { centre: 'Center' }, colour: 'Color' },
};
