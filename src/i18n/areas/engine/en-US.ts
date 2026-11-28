import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** American English: only the spellings that differ from British English. */
export const enUS: AreaTranslation<typeof source> = {
  steps: { colourMixer: 'Color mixer', denoiseColour: 'Color noise' },
  auto: {
    multipleSubjects: 'Each subject was checked on its own for lost highlights and shadows. Species color correction was held back.',
    speciesReference: (features) => `Species reference (a guide, not a measured color): ${features}`,
    reasons: {
      clipWhite: 'Brightening would blow bright areas, such as water specks, out to pure white.',
      crushedBlack: 'The edit would crush dark areas to pure black.',
      vividColours: 'The edit would change vivid colors, such as plumage, too far.',
      lostDetail: 'The edit would lose fine detail, or highlight and shadow detail.',
      halos: 'The edit would add halos around sharp edges.',
      subjectSmall: 'The subject is small in the frame, so the check could not be sure.',
      crunchyBackground: 'The edit would make the out-of-focus background look crunchier.',
      noisyShadows: 'The edit would brighten noisy shadows into gray.',
      flatBackground: 'The edit would flatten the bright background.',
      noSafeLift: 'No safe lift was found: lifting it would clip highlights or show noise.',
      strongColour: 'Color is strong or clipped, and softening it was not safe.',
      incomplete: 'The check could not be completed, so nothing was changed.',
      noneChecked: 'No edit passed every check, so nothing was changed.',
      keptDark: 'This photo is tagged as dark on purpose (Low key, night or similar), so it was left as it is. Remove the tag to let Auto brighten the subject.',
    },
  },
  workspace: {
    exportQueued: (count) => (count === 1
      ? 'Queued 1 export. You can keep editing; open Tasks to pause, prioritize or cancel.'
      : `Queued ${count} exports. You can keep editing; open Tasks to pause, prioritize or cancel.`),
    checkTask: (filename) => `Checking ${filename} and its color`,
    checkStage: 'Looking at exposure, color and scene',
  },
};
