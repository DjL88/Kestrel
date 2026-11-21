import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Swedish. DRAFT: written without a native speaker's check. Colour names sit in brackets. */
export const sv: AreaTranslation<typeof source> = {
  title: 'Färgkontroll',
  intro: 'Kite44 namnger färgerna i den här bilden och berättar med ord om allt som kan se fel ut.',
  checking: 'Kontrollerar färg…',
  unavailable: 'Färgkontrollen är inte tillgänglig för den här bilden än.',
  mainColours: 'Huvudfärger',
  nothingToFix: 'Inget ser fel ut med färgen i den här lilla förhandsvisningen.',
  watchOut: 'Se upp:',
  tip: 'Tips:',
  note: 'Obs:',
  family: {
    red: 'röd', orange: 'orange', brown: 'brun', yellow: 'gul', lime: 'gulgrön', green: 'grön', teal: 'blågrön',
    blue: 'blå', purple: 'lila', pink: 'rosa', grey: 'grå', black: 'svart', white: 'vit',
  },
  strength: { none: 'ingen färg', muted: 'mjuk', moderate: 'medel', strong: 'stark', veryStrong: 'mycket stark' },
  share: (percent) => (percent >= 45 ? 'ungefär hälften eller mer' : percent >= 25 ? 'ungefär en fjärdedel eller mer' : percent >= 10 ? 'en stor del' : 'lite'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} och ${second}`,
  strongColour: (colours, percent) => `Mycket stark färg (${colours}) täcker ${percent} % av bilden. Det kan se overkligt ut på skärmen och bli dåligt i tryck.`,
  clippedColour: (colours) => `Vissa ytor (${colours}) är för starka för att visa sina detaljer, så de ser platta ut.`,
  cast: {
    warm: 'Det som borde vara grått eller vitt ser lite gult eller orange ut (en varm ton).',
    cool: 'Det som borde vara grått eller vitt ser lite blått ut (en kall ton).',
    green: 'Det som borde vara grått eller vitt ser lite grönt ut.',
    magenta: 'Det som borde vara grått eller vitt ser lite rosa eller lila ut.',
  },
  castClear: 'Tonen är tydlig nog för att de flesta ska märka den.',
  muted: 'Det finns nästan ingen färg i den här bilden. Det går bra om du vill ha den nästan svartvit.',
  redGreen: (first, second) => `Ytorna (${first} och ${second}) är ungefär lika ljusa, så många färgblinda får svårt att skilja dem åt.`,
  redGreenHint: 'Om du gör en av dem ljusare eller mörkare blir skillnaden lättare att se för alla.',
  subject: (subjectColour, strength, surroundings) => `Ditt motiv: ${subjectColour}, ${strength}. Runt omkring: mest ${surroundings}.`,
  editStronger: (percent) => `Din redigering har gjort färgerna ${percent} % starkare än originalet.`,
  editWeaker: (percent) => `Din redigering har gjort färgerna ${percent} % mjukare än originalet.`,
  fixSoften: 'Dämpa färgen',
  fixCooler: 'Gör kallare',
  fixWarmer: 'Gör varmare',
  fixApplied: 'Klart. Du kan ångra det i redigeringshistoriken.',
  findings: (count) => plural(count, { one: `${count} sak att titta på`, other: `${count} saker att titta på` }),
};
