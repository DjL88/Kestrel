import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** American English: only the spellings that differ from British English. */
export const enUS: AreaTranslation<typeof source> = {
  steps: { colourMixer: 'Color mixer', denoiseColour: 'Color noise' },
  auto: {
    multipleSubjects: 'Each subject was checked on its own for lost highlights and shadows. Species color correction was held back.',
    speciesReference: (features) => `Species reference (a guide, not a measured color): ${features}`,
  },
  workspace: {
    exportQueued: (count) => (count === 1
      ? 'Queued 1 export. You can keep editing; open Tasks to pause, prioritize or cancel.'
      : `Queued ${count} exports. You can keep editing; open Tasks to pause, prioritize or cancel.`),
    checkTask: (filename) => `Checking ${filename} and its color`,
    checkStage: 'Looking at exposure, color and scene',
  },
};
