import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Icelandic. DRAFT: written without a native speaker's check. Colour names are neuter forms in brackets, so they never need to agree. */
export const is: AreaTranslation<typeof source> = {
  title: 'Litaskoðun',
  intro: 'InFlight nefnir litina í þessari mynd og bendir með orðum á allt sem gæti litið rangt út.',
  checking: 'Skoða lit…',
  unavailable: 'Litaskoðun er ekki enn í boði fyrir þessa mynd.',
  mainColours: 'Helstu litir',
  nothingToFix: 'Ekkert virðist athugavert við litinn í þessari litlu forskoðun.',
  watchOut: 'Varúð:',
  tip: 'Ábending:',
  note: 'Athugið:',
  family: {
    red: 'rautt', orange: 'appelsínugult', brown: 'brúnt', yellow: 'gult', lime: 'gulgrænt', green: 'grænt', teal: 'blágrænt',
    blue: 'blátt', purple: 'fjólublátt', pink: 'bleikt', grey: 'grátt', black: 'svart', white: 'hvítt',
  },
  strength: { none: 'enginn litur', muted: 'mildur litur', moderate: 'miðlungs litur', strong: 'sterkur litur', veryStrong: 'mjög sterkur litur' },
  share: (percent) => (percent >= 45 ? 'um helmingur eða meira' : percent >= 25 ? 'um fjórðungur eða meira' : percent >= 10 ? 'góður hluti' : 'lítið'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} og ${second}`,
  strongColour: (colours, percent) => `Mjög sterkur litur (${colours}) þekur ${percent}% myndarinnar. Hann getur virst óraunverulegur á skjá og prentast illa.`,
  clippedColour: (colours) => `Sum svæði (${colours}) eru of sterk til að sýna smáatriði, svo þau virðast flöt.`,
  cast: {
    warm: 'Það sem ætti að vera grátt eða hvítt virðist örlítið gult eða appelsínugult (hlýr blær).',
    cool: 'Það sem ætti að vera grátt eða hvítt virðist örlítið blátt (kaldur blær).',
    green: 'Það sem ætti að vera grátt eða hvítt virðist örlítið grænt.',
    magenta: 'Það sem ætti að vera grátt eða hvítt virðist örlítið bleikt eða fjólublátt.',
  },
  castClear: 'Blærinn er nógu greinilegur til að flestir taki eftir honum.',
  muted: 'Það er varla neinn litur í þessari mynd. Það er í lagi ef þú vilt hafa hana nánast svarthvíta.',
  redGreen: (first, second) => `Svæðin (${first} og ${second}) eru álíka björt, svo margt litblint fólk á erfitt með að greina þau í sundur.`,
  redGreenHint: 'Ef þú gerir annað þeirra ljósara eða dekkra sjá allir muninn betur.',
  subject: (subjectColour, strength, surroundings) => `Myndefnið: ${subjectColour}, ${strength}. Í kring: aðallega ${surroundings}.`,
  editStronger: (percent) => `Breytingin þín hefur gert litina ${percent}% sterkari en í upprunalegu myndinni.`,
  editWeaker: (percent) => `Breytingin þín hefur gert litina ${percent}% mildari en í upprunalegu myndinni.`,
  fixSoften: 'Milda lit',
  fixCooler: 'Gera kaldari',
  fixWarmer: 'Gera hlýrri',
  fixApplied: 'Búið. Þú getur afturkallað það í breytingaferlinum.',
  findings: (count) => plural(count, { one: `${count} atriði til að skoða`, other: `${count} atriði til að skoða` }),
};
