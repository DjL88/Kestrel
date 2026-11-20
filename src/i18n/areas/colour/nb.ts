import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. Colour names sit in brackets. */
export const nb: AreaTranslation<typeof source> = {
  title: 'Fargesjekk',
  intro: 'Kestrel navngir fargene i dette bildet og forteller med ord om alt som kan se feil ut.',
  checking: 'Sjekker farge…',
  unavailable: 'Fargesjekken er ikke tilgjengelig for dette bildet ennå.',
  mainColours: 'Hovedfarger',
  nothingToFix: 'Ingenting ser feil ut med fargen i denne lille forhåndsvisningen.',
  watchOut: 'Se opp:',
  tip: 'Tips:',
  note: 'Merk:',
  family: {
    red: 'rød', orange: 'oransje', brown: 'brun', yellow: 'gul', lime: 'gulgrønn', green: 'grønn', teal: 'blågrønn',
    blue: 'blå', purple: 'lilla', pink: 'rosa', grey: 'grå', black: 'svart', white: 'hvit',
  },
  strength: { none: 'ingen farge', muted: 'myk', moderate: 'middels', strong: 'sterk', veryStrong: 'svært sterk' },
  share: (percent) => (percent >= 45 ? 'omtrent halvparten eller mer' : percent >= 25 ? 'omtrent en firedel eller mer' : percent >= 10 ? 'en god del' : 'litt'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} og ${second}`,
  strongColour: (colours, percent) => `Svært sterk farge (${colours}) dekker ${percent} % av bildet. Det kan se uvirkelig ut på skjermen og bli dårlig på trykk.`,
  clippedColour: (colours) => `Noen områder (${colours}) er for sterke til å vise detaljene sine, så de ser flate ut.`,
  cast: {
    warm: 'Det som burde være grått eller hvitt, ser litt gult eller oransje ut (et varmt skjær).',
    cool: 'Det som burde være grått eller hvitt, ser litt blått ut (et kaldt skjær).',
    green: 'Det som burde være grått eller hvitt, ser litt grønt ut.',
    magenta: 'Det som burde være grått eller hvitt, ser litt rosa eller lilla ut.',
  },
  castClear: 'Skjæret er tydelig nok til at de fleste vil legge merke til det.',
  muted: 'Det er nesten ingen farge i dette bildet. Det er greit hvis du vil ha det nesten svart-hvitt.',
  redGreen: (first, second) => `Områdene (${first} og ${second}) er omtrent like lyse, så mange fargeblinde vil ha vanskelig for å skille dem fra hverandre.`,
  redGreenHint: 'Gjør du ett av dem lysere eller mørkere, blir forskjellen lettere å se for alle.',
  subject: (subjectColour, strength, surroundings) => `Motivet ditt: ${subjectColour}, ${strength}. Rundt: mest ${surroundings}.`,
  editStronger: (percent) => `Redigeringen din har gjort fargene ${percent} % sterkere enn originalen.`,
  editWeaker: (percent) => `Redigeringen din har gjort fargene ${percent} % mykere enn originalen.`,
  fixSoften: 'Demp fargen',
  fixCooler: 'Gjør kaldere',
  fixWarmer: 'Gjør varmere',
  fixApplied: 'Ferdig. Du kan angre det fra redigeringshistorikken.',
  findings: (count) => plural(count, { one: `${count} ting å se på`, other: `${count} ting å se på` }),
};
