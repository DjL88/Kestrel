import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Dutch (u). DRAFT: written without a native speaker's check. Colour names sit in brackets or after "in". */
export const nl: AreaTranslation<typeof source> = {
  title: 'Kleurcontrole',
  intro: 'Kite44 benoemt de kleuren in deze foto en wijst in woorden op alles wat misschien niet goed lijkt.',
  checking: 'Kleur controleren…',
  unavailable: 'De kleurcontrole is nog niet beschikbaar voor deze foto.',
  mainColours: 'Hoofdkleuren',
  nothingToFix: 'Er lijkt niets mis met de kleur in deze kleine voorvertoning.',
  watchOut: 'Let op:',
  tip: 'Tip:',
  note: 'Opmerking:',
  family: {
    red: 'rood', orange: 'oranje', brown: 'bruin', yellow: 'geel', lime: 'geelgroen', green: 'groen', teal: 'blauwgroen',
    blue: 'blauw', purple: 'paars', pink: 'roze', grey: 'grijs', black: 'zwart', white: 'wit',
  },
  strength: { none: 'geen kleur', muted: 'zacht', moderate: 'gemiddeld', strong: 'sterk', veryStrong: 'heel sterk' },
  share: (percent) => (percent >= 45 ? 'ongeveer de helft of meer' : percent >= 25 ? 'ongeveer een kwart of meer' : percent >= 10 ? 'een flink deel' : 'een beetje'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} en ${second}`,
  strongColour: (colours, percent) => `Heel sterke kleur (${colours}) bedekt ${percent}% van de foto. Dat kan op een scherm onecht lijken en slecht afdrukken.`,
  clippedColour: (colours) => `Sommige delen in ${colours} zijn te sterk om hun details te tonen, dus ze zien er vlak uit.`,
  cast: {
    warm: 'Wat grijs of wit zou moeten zijn, ziet er een beetje geel of oranje uit (een warme zweem).',
    cool: 'Wat grijs of wit zou moeten zijn, ziet er een beetje blauw uit (een koele zweem).',
    green: 'Wat grijs of wit zou moeten zijn, ziet er een beetje groen uit.',
    magenta: 'Wat grijs of wit zou moeten zijn, ziet er een beetje roze of paars uit.',
  },
  castClear: 'De zweem is duidelijk genoeg dat de meeste mensen hem zullen zien.',
  muted: 'Er zit bijna geen kleur in deze foto. Dat is prima als u hem bijna zwart-wit wilt.',
  redGreen: (first, second) => `De delen in ${first} en ${second} zijn ongeveer even licht, dus veel kleurenblinde mensen kunnen ze moeilijk uit elkaar houden.`,
  redGreenHint: 'Eén ervan lichter of donkerder maken helpt iedereen om het verschil te zien.',
  subject: (subjectColour, strength, surroundings) => `Uw onderwerp: ${subjectColour}, ${strength}. Eromheen: vooral ${surroundings}.`,
  editStronger: (percent) => `Uw bewerking heeft de kleuren ${percent}% sterker gemaakt dan het origineel.`,
  editWeaker: (percent) => `Uw bewerking heeft de kleuren ${percent}% zachter gemaakt dan het origineel.`,
  fixSoften: 'Kleur verzachten',
  fixCooler: 'Koeler maken',
  fixWarmer: 'Warmer maken',
  fixApplied: 'Klaar. U kunt dit ongedaan maken via de bewerkingsgeschiedenis.',
  findings: (count) => plural(count, { one: `${count} punt om te bekijken`, other: `${count} punten om te bekijken` }),
};
