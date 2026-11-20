import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Danish. DRAFT: written without a native speaker's check. Colour names sit in brackets. */
export const da: AreaTranslation<typeof source> = {
  title: 'Farvetjek',
  intro: 'Kestrel navngiver farverne i dette billede og fortæller med ord om alt, der måske ser forkert ud.',
  checking: 'Tjekker farve…',
  unavailable: 'Farvetjekket er ikke tilgængeligt for dette billede endnu.',
  mainColours: 'Hovedfarver',
  nothingToFix: 'Intet ser forkert ud med farven i denne lille forhåndsvisning.',
  watchOut: 'Pas på:',
  tip: 'Tip:',
  note: 'Bemærk:',
  family: {
    red: 'rød', orange: 'orange', brown: 'brun', yellow: 'gul', lime: 'gulgrøn', green: 'grøn', teal: 'blågrøn',
    blue: 'blå', purple: 'lilla', pink: 'lyserød', grey: 'grå', black: 'sort', white: 'hvid',
  },
  strength: { none: 'ingen farve', muted: 'blød', moderate: 'middel', strong: 'stærk', veryStrong: 'meget stærk' },
  share: (percent) => (percent >= 45 ? 'cirka halvdelen eller mere' : percent >= 25 ? 'cirka en fjerdedel eller mere' : percent >= 10 ? 'en god del' : 'lidt'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} og ${second}`,
  strongColour: (colours, percent) => `Meget stærk farve (${colours}) dækker ${percent} % af billedet. Det kan se uvirkeligt ud på skærmen og blive dårligt på tryk.`,
  clippedColour: (colours) => `Nogle områder (${colours}) er for stærke til at vise deres detaljer, så de ser flade ud.`,
  cast: {
    warm: 'Ting, der burde være grå eller hvide, ser lidt gule eller orange ud (et varmt skær).',
    cool: 'Ting, der burde være grå eller hvide, ser lidt blå ud (et koldt skær).',
    green: 'Ting, der burde være grå eller hvide, ser lidt grønne ud.',
    magenta: 'Ting, der burde være grå eller hvide, ser lidt lyserøde eller lilla ud.',
  },
  castClear: 'Skæret er tydeligt nok til, at de fleste vil lægge mærke til det.',
  muted: 'Der er næsten ingen farve i dette billede. Det er fint, hvis du vil have det næsten sort-hvidt.',
  redGreen: (first, second) => `Områderne (${first} og ${second}) er omtrent lige lyse, så mange farveblinde vil have svært ved at skelne dem fra hinanden.`,
  redGreenHint: 'Gør du et af dem lysere eller mørkere, bliver forskellen lettere at se for alle.',
  subject: (subjectColour, strength, surroundings) => `Dit motiv: ${subjectColour}, ${strength}. Omkring: mest ${surroundings}.`,
  editStronger: (percent) => `Din redigering har gjort farverne ${percent} % stærkere end originalen.`,
  editWeaker: (percent) => `Din redigering har gjort farverne ${percent} % blødere end originalen.`,
  fixSoften: 'Dæmp farven',
  fixCooler: 'Gør køligere',
  fixWarmer: 'Gør varmere',
  fixApplied: 'Færdig. Du kan fortryde det fra redigeringshistorikken.',
  findings: (count) => plural(count, { one: `${count} ting at se på`, other: `${count} ting at se på` }),
};
