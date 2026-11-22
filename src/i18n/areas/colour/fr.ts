import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** French (vous). DRAFT: written without a native speaker's check. Colour names sit in brackets or after "en" so they never need to agree. */
export const fr: AreaTranslation<typeof source> = {
  title: 'Contrôle des couleurs',
  intro: 'InFlight nomme les couleurs de cette photo et signale, avec des mots, tout ce qui pourrait sembler incorrect.',
  checking: 'Vérification des couleurs…',
  unavailable: 'Le contrôle des couleurs n’est pas encore disponible pour cette photo.',
  mainColours: 'Couleurs principales',
  nothingToFix: 'Rien ne semble incorrect dans les couleurs de ce petit aperçu.',
  watchOut: 'Attention :',
  tip: 'Conseil :',
  note: 'Remarque :',
  family: {
    red: 'rouge', orange: 'orange', brown: 'marron', yellow: 'jaune', lime: 'jaune-vert', green: 'vert', teal: 'bleu-vert',
    blue: 'bleu', purple: 'violet', pink: 'rose', grey: 'gris', black: 'noir', white: 'blanc',
  },
  strength: { none: 'sans couleur', muted: 'doux', moderate: 'moyen', strong: 'fort', veryStrong: 'très fort' },
  share: (percent) => (percent >= 45 ? 'environ la moitié ou plus' : percent >= 25 ? 'environ un quart ou plus' : percent >= 10 ? 'une bonne partie' : 'un peu'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength} : ${share}`,
  and: (first, second) => `${first} et ${second}`,
  strongColour: (colours, percent) => `Une couleur très vive (${colours}) couvre ${percent} % de la photo. Elle peut sembler irréelle à l’écran et mal s’imprimer.`,
  clippedColour: (colours) => `Certaines zones (${colours}) sont trop vives pour montrer leurs détails : elles paraissent plates.`,
  cast: {
    warm: 'Ce qui devrait être gris ou blanc paraît un peu jaune ou orange (une dominante chaude).',
    cool: 'Ce qui devrait être gris ou blanc paraît un peu bleu (une dominante froide).',
    green: 'Ce qui devrait être gris ou blanc paraît un peu vert.',
    magenta: 'Ce qui devrait être gris ou blanc paraît un peu rose ou violet.',
  },
  castClear: 'La teinte est assez nette pour que la plupart des gens la remarquent.',
  muted: 'Cette photo n’a presque pas de couleur. C’est très bien si vous la voulez presque en noir et blanc.',
  redGreen: (first, second) => `Les zones en ${first} et en ${second} ont à peu près la même luminosité : beaucoup de personnes daltoniennes auront du mal à les distinguer.`,
  redGreenHint: 'Rendre l’une d’elles plus claire ou plus sombre aide tout le monde à voir la différence.',
  subject: (subjectColour, strength, surroundings) => `Votre sujet : ${subjectColour}, ${strength}. Autour : surtout ${surroundings}.`,
  editStronger: (percent) => `Votre retouche a rendu les couleurs plus vives de ${percent} % par rapport à l’original.`,
  editWeaker: (percent) => `Votre retouche a rendu les couleurs plus douces de ${percent} % par rapport à l’original.`,
  fixSoften: 'Adoucir la couleur',
  fixCooler: 'Rendre plus froid',
  fixWarmer: 'Rendre plus chaud',
  fixApplied: 'C’est fait. Vous pouvez l’annuler depuis l’historique des retouches.',
  findings: (count) => plural(count, { one: `${count} point à examiner`, other: `${count} points à examiner` }),
};
