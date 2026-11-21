import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Finnish. DRAFT: written without a native speaker's check. Colour names stay in the nominative, in brackets or after "väri on". */
export const fi: AreaTranslation<typeof source> = {
  title: 'Värintarkistus',
  intro: 'Kestrel kertoo sanoin, mitä värejä tässä kuvassa on, ja mainitsee kaiken, mikä voi näyttää väärältä.',
  checking: 'Tarkistetaan väriä…',
  unavailable: 'Värintarkistus ei ole vielä käytettävissä tälle kuvalle.',
  mainColours: 'Päävärit',
  nothingToFix: 'Tämän pienen esikatselun väreissä ei näytä olevan mitään vikaa.',
  watchOut: 'Huomio:',
  tip: 'Vinkki:',
  note: 'Tiedoksi:',
  family: {
    red: 'punainen', orange: 'oranssi', brown: 'ruskea', yellow: 'keltainen', lime: 'kellanvihreä', green: 'vihreä', teal: 'sinivihreä',
    blue: 'sininen', purple: 'violetti', pink: 'vaaleanpunainen', grey: 'harmaa', black: 'musta', white: 'valkoinen',
  },
  strength: { none: 'ei väriä', muted: 'hillitty', moderate: 'keskivahva', strong: 'voimakas', veryStrong: 'hyvin voimakas' },
  share: (percent) => (percent >= 45 ? 'noin puolet tai enemmän' : percent >= 25 ? 'noin neljännes tai enemmän' : percent >= 10 ? 'melko suuri osa' : 'vähän'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} ja ${second}`,
  strongColour: (colours, percent) => `Hyvin voimakas väri (${colours}) peittää ${percent} % kuvasta. Se voi näyttää näytöllä epätodelliselta ja tulostua huonosti.`,
  clippedColour: (colours) => `Jotkin alueet (${colours}) ovat liian voimakkaita näyttääkseen yksityiskohtia, joten ne näyttävät litteiltä.`,
  cast: {
    warm: 'Asiat, joiden pitäisi olla harmaita tai valkoisia, näyttävät hieman keltaisilta tai oransseilta (lämmin sävy).',
    cool: 'Asiat, joiden pitäisi olla harmaita tai valkoisia, näyttävät hieman sinisiltä (kylmä sävy).',
    green: 'Asiat, joiden pitäisi olla harmaita tai valkoisia, näyttävät hieman vihreiltä.',
    magenta: 'Asiat, joiden pitäisi olla harmaita tai valkoisia, näyttävät hieman vaaleanpunaisilta tai violeteilta.',
  },
  castClear: 'Sävy on niin selvä, että useimmat huomaavat sen.',
  muted: 'Tässä kuvassa ei ole juuri lainkaan väriä. Se sopii, jos haluat kuvan lähes mustavalkoiseksi.',
  redGreen: (first, second) => `Alueet, joiden väri on ${first} ja ${second}, ovat suunnilleen yhtä kirkkaita, joten monen värisokean on vaikea erottaa niitä toisistaan.`,
  redGreenHint: 'Kun teet toisesta vaaleamman tai tummemman, kaikki näkevät eron helpommin.',
  subject: (subjectColour, strength, surroundings) => `Kohteesi: ${subjectColour}, ${strength}. Ympärillä: enimmäkseen ${surroundings}.`,
  editStronger: (percent) => `Muokkauksesi on tehnyt väreistä ${percent} % voimakkaampia kuin alkuperäisessä.`,
  editWeaker: (percent) => `Muokkauksesi on tehnyt väreistä ${percent} % hillitympiä kuin alkuperäisessä.`,
  fixSoften: 'Hillitse väriä',
  fixCooler: 'Tee viileämmäksi',
  fixWarmer: 'Tee lämpimämmäksi',
  fixApplied: 'Valmis. Voit kumota sen muokkaushistoriasta.',
  findings: (count) => plural(count, { one: `${count} katsottava asia`, other: `${count} katsottavaa asiaa` }),
};
