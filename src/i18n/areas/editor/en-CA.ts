import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Canadian English keeps British spellings (colour, centre, cancelled) but writes "analyze". */
export const enCA: AreaTranslation<typeof source> = {
  auto: {
    analysingButton: 'Analyzing…',
    analysing: 'Analyzing your photograph on this device…',
    couldNotAnalyse: 'Could not analyze this photo. Your edits have not changed.',
    tooSmall: 'This preview is too small to analyze. Your edits have not changed.',
    notAnalysed: 'This preview could not be analyzed. Your edits have not changed.',
  },
};
