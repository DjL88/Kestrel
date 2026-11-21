import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Italian (tu). DRAFT: written without a native speaker's check. Colour names sit in brackets or after "in". */
export const it: AreaTranslation<typeof source> = {
  title: 'Controllo colore',
  intro: 'Kestrel indica a parole i colori di questa foto e segnala tutto ciò che potrebbe sembrare sbagliato.',
  checking: 'Controllo del colore…',
  unavailable: 'Il controllo colore non è ancora disponibile per questa foto.',
  mainColours: 'Colori principali',
  nothingToFix: 'Nel colore di questa piccola anteprima non sembra esserci nulla di sbagliato.',
  watchOut: 'Attenzione:',
  tip: 'Consiglio:',
  note: 'Nota:',
  family: {
    red: 'rosso', orange: 'arancione', brown: 'marrone', yellow: 'giallo', lime: 'giallo-verde', green: 'verde', teal: 'verde acqua',
    blue: 'blu', purple: 'viola', pink: 'rosa', grey: 'grigio', black: 'nero', white: 'bianco',
  },
  strength: { none: 'nessun colore', muted: 'tenue', moderate: 'medio', strong: 'intenso', veryStrong: 'molto intenso' },
  share: (percent) => (percent >= 45 ? 'circa metà o più' : percent >= 25 ? 'circa un quarto o più' : percent >= 10 ? 'una buona parte' : 'un po’'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} e ${second}`,
  strongColour: (colours, percent) => `Un colore molto intenso (${colours}) copre il ${percent}% della foto. Può sembrare irreale sullo schermo e stamparsi male.`,
  clippedColour: (colours) => `Alcune zone in ${colours} sono troppo intense per mostrare i dettagli, quindi sembrano piatte.`,
  cast: {
    warm: 'Ciò che dovrebbe essere grigio o bianco sembra un po’ giallo o arancione (una dominante calda).',
    cool: 'Ciò che dovrebbe essere grigio o bianco sembra un po’ blu (una dominante fredda).',
    green: 'Ciò che dovrebbe essere grigio o bianco sembra un po’ verde.',
    magenta: 'Ciò che dovrebbe essere grigio o bianco sembra un po’ rosa o viola.',
  },
  castClear: 'La dominante è abbastanza evidente da essere notata dalla maggior parte delle persone.',
  muted: 'In questa foto c’è pochissimo colore. Va bene se la vuoi quasi in bianco e nero.',
  redGreen: (first, second) => `Le zone in ${first} e in ${second} hanno più o meno la stessa luminosità, quindi molte persone daltoniche faranno fatica a distinguerle.`,
  redGreenHint: 'Rendere una delle due più chiara o più scura aiuta tutti a vedere la differenza.',
  subject: (subjectColour, strength, surroundings) => `Il tuo soggetto: ${subjectColour}, ${strength}. Intorno: soprattutto ${surroundings}.`,
  editStronger: (percent) => `La tua modifica ha reso i colori più intensi del ${percent}% rispetto all’originale.`,
  editWeaker: (percent) => `La tua modifica ha reso i colori più tenui del ${percent}% rispetto all’originale.`,
  fixSoften: 'Attenua il colore',
  fixCooler: 'Rendi più freddo',
  fixWarmer: 'Rendi più caldo',
  fixApplied: 'Fatto. Puoi annullarlo dalla cronologia modifiche.',
  findings: (count) => plural(count, { one: `${count} cosa da controllare`, other: `${count} cose da controllare` }),
};
