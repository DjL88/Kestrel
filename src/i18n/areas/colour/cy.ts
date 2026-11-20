import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** "a" becomes "ac" before a vowel. Mutations after "a" are not applied, so colour names stay in their base form. */
const and = (first: string, second: string) => `${first} ${/^[aeiouwy]/i.test(second) ? 'ac' : 'a'} ${second}`;

/** Welsh. DRAFT: written without a native speaker's check. Colour names sit in brackets so they keep their base form. */
export const cy: AreaTranslation<typeof source> = {
  title: 'Gwirio lliw',
  intro: 'Mae Kestrel yn enwi’r lliwiau yn y llun hwn ac yn tynnu sylw, mewn geiriau, at unrhyw beth a allai edrych yn anghywir.',
  checking: 'Yn gwirio’r lliw…',
  unavailable: 'Dyw’r gwiriad lliw ddim ar gael ar gyfer y llun hwn eto.',
  mainColours: 'Prif liwiau',
  nothingToFix: 'Does dim byd yn edrych yn anghywir gyda’r lliw yn y rhagolwg bach hwn.',
  watchOut: 'Gofal:',
  tip: 'Awgrym:',
  note: 'Nodyn:',
  family: {
    red: 'coch', orange: 'oren', brown: 'brown', yellow: 'melyn', lime: 'melynwyrdd', green: 'gwyrdd', teal: 'gwyrddlas',
    blue: 'glas', purple: 'porffor', pink: 'pinc', grey: 'llwyd', black: 'du', white: 'gwyn',
  },
  strength: { none: 'dim lliw', muted: 'meddal', moderate: 'canolig', strong: 'cryf', veryStrong: 'cryf iawn' },
  share: (percent) => (percent >= 45 ? 'tua hanner neu fwy' : percent >= 25 ? 'tua chwarter neu fwy' : percent >= 10 ? 'cryn dipyn' : 'ychydig'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and,
  strongColour: (colours, percent) => `Mae lliw cryf iawn (${colours}) yn gorchuddio ${percent}% o’r llun. Gall edrych yn afreal ar sgrin ac argraffu’n wael.`,
  clippedColour: (colours) => `Mae rhai ardaloedd (${colours}) yn rhy gryf i ddangos eu manylion, felly maen nhw’n edrych yn fflat.`,
  cast: {
    warm: 'Mae pethau a ddylai fod yn llwyd neu’n wyn yn edrych ychydig yn felyn neu’n oren (arlliw cynnes).',
    cool: 'Mae pethau a ddylai fod yn llwyd neu’n wyn yn edrych ychydig yn las (arlliw oer).',
    green: 'Mae pethau a ddylai fod yn llwyd neu’n wyn yn edrych ychydig yn wyrdd.',
    magenta: 'Mae pethau a ddylai fod yn llwyd neu’n wyn yn edrych ychydig yn binc neu’n borffor.',
  },
  castClear: 'Mae’r arlliw yn ddigon amlwg i’r rhan fwyaf o bobl sylwi arno.',
  muted: 'Prin bod unrhyw liw yn y llun hwn. Mae hynny’n iawn os ydych chi am iddo fod bron yn ddu a gwyn.',
  redGreen: (first, second) => `Mae’r ardaloedd (${and(first, second)}) tua’r un mor olau, felly bydd llawer o bobl sy’n lliwddall yn ei chael hi’n anodd gweld y gwahaniaeth rhyngddyn nhw.`,
  redGreenHint: 'Mae gwneud un ohonyn nhw’n oleuach neu’n dywyllach yn helpu pawb i weld y gwahaniaeth.',
  subject: (subjectColour, strength, surroundings) => `Eich prif wrthrych: ${subjectColour}, ${strength}. O’i gwmpas: ${surroundings} gan fwyaf.`,
  editStronger: (percent) => `Mae eich golygiad wedi gwneud y lliwiau ${percent}% yn gryfach na’r gwreiddiol.`,
  editWeaker: (percent) => `Mae eich golygiad wedi gwneud y lliwiau ${percent}% yn feddalach na’r gwreiddiol.`,
  fixSoften: 'Meddalu’r lliw',
  fixCooler: 'Gwneud yn oerach',
  fixWarmer: 'Gwneud yn gynhesach',
  fixApplied: 'Wedi gorffen. Gallwch ei ddadwneud o’r hanes golygu.',
  findings: (count) => plural(count, { one: `${count} peth i edrych arno`, other: `${count} peth i edrych arnyn nhw` }),
};
