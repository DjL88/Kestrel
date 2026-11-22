import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only what differs from British English (catalog, color, analyze). */
export const enUS: AreaTranslation<typeof source> = {
  projects: {
    catalogueUnavailable: 'Could not open the local project catalog. Reload to try again.',
  },
  backup: {
    saved: 'Catalog backup saved. Keep the original photos separately.',
    downloaded: 'Catalog backup downloaded. Keep the original photos separately.',
    failed: 'Could not save the catalog backup. Try another destination.',
  },
  tasks: {
    analysedWithAdjustments: (count) => `${count} photos analyzed with usable adjustments`,
  },
  editorBar: {
    copyTitle: 'Copy this photo\'s edits (light, color, detail and masks). The crop is not copied.',
    pasteTitle: 'Paste the copied edits (light, color, detail and masks) onto this photo. Its crop stays as it is.',
  },
  confirm: {
    autoAdjustSelected: {
      confirm: 'Analyze selected photos',
      ownAdjustments: 'Each selected photo gets its own local light and color adjustments. These are not the same preset applied to everyone.',
    },
    autoAdjustKeepers: {
      what: 'InFlight will analyze each unedited keeper locally and adjust its light, color and tone. Already edited photos stay unchanged.',
    },
  },
};
