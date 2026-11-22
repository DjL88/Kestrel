import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** German (Sie). DRAFT: written without a native speaker's check. Colour names are nouns, used in brackets or after "in". */
export const de: AreaTranslation<typeof source> = {
  title: 'Farbprüfung',
  intro: 'InFlight benennt die Farben in diesem Foto und weist in Worten auf alles hin, was falsch aussehen könnte.',
  checking: 'Farbe wird geprüft…',
  unavailable: 'Die Farbprüfung ist für dieses Foto noch nicht verfügbar.',
  mainColours: 'Hauptfarben',
  nothingToFix: 'In dieser kleinen Vorschau sieht an der Farbe nichts falsch aus.',
  watchOut: 'Achtung:',
  tip: 'Tipp:',
  note: 'Hinweis:',
  family: {
    red: 'Rot', orange: 'Orange', brown: 'Braun', yellow: 'Gelb', lime: 'Gelbgrün', green: 'Grün', teal: 'Blaugrün',
    blue: 'Blau', purple: 'Lila', pink: 'Rosa', grey: 'Grau', black: 'Schwarz', white: 'Weiß',
  },
  strength: { none: 'keine Farbe', muted: 'sanft', moderate: 'mittel', strong: 'kräftig', veryStrong: 'sehr kräftig' },
  share: (percent) => (percent >= 45 ? 'etwa die Hälfte oder mehr' : percent >= 25 ? 'etwa ein Viertel oder mehr' : percent >= 10 ? 'ein guter Teil' : 'ein wenig'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} und ${second}`,
  strongColour: (colours, percent) => `Sehr kräftige Farbe (${colours}) bedeckt ${percent} % des Fotos. Das kann am Bildschirm unecht wirken und schlecht drucken.`,
  clippedColour: (colours) => `Einige Bereiche in ${colours} sind zu kräftig, um ihre Details zu zeigen, und wirken deshalb flach.`,
  cast: {
    warm: 'Was grau oder weiß sein sollte, wirkt etwas gelb oder orange (ein warmer Farbstich).',
    cool: 'Was grau oder weiß sein sollte, wirkt etwas blau (ein kühler Farbstich).',
    green: 'Was grau oder weiß sein sollte, wirkt etwas grün.',
    magenta: 'Was grau oder weiß sein sollte, wirkt etwas rosa oder lila.',
  },
  castClear: 'Der Farbstich ist so deutlich, dass die meisten Menschen ihn bemerken.',
  muted: 'Dieses Foto hat kaum Farbe. Das ist in Ordnung, wenn Sie es fast schwarz-weiß möchten.',
  redGreen: (first, second) => `Die Bereiche in ${first} und ${second} sind etwa gleich hell, daher können viele farbenblinde Menschen sie nur schwer unterscheiden.`,
  redGreenHint: 'Wenn Sie einen davon heller oder dunkler machen, sieht jeder den Unterschied besser.',
  subject: (subjectColour, strength, surroundings) => `Ihr Motiv: ${subjectColour}, ${strength}. Umgebung: vor allem ${surroundings}.`,
  editStronger: (percent) => `Ihre Bearbeitung hat die Farben um ${percent} % kräftiger gemacht als im Original.`,
  editWeaker: (percent) => `Ihre Bearbeitung hat die Farben um ${percent} % sanfter gemacht als im Original.`,
  fixSoften: 'Farbe abschwächen',
  fixCooler: 'Kühler machen',
  fixWarmer: 'Wärmer machen',
  fixApplied: 'Erledigt. Sie können es im Bearbeitungsverlauf rückgängig machen.',
  findings: (count) => plural(count, { one: `${count} Punkt zum Prüfen`, other: `${count} Punkte zum Prüfen` }),
};
