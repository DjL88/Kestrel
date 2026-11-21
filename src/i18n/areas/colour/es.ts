import type { AreaTranslation } from '../../localise';
import type { source } from './source';
import { plural } from '../../../core/locale';

/** Spanish, Spain (usted). DRAFT: written without a native speaker's check. Colour names sit in brackets or after "en". */
export const es: AreaTranslation<typeof source> = {
  title: 'Revisión del color',
  intro: 'Kite44 nombra los colores de esta foto y señala con palabras cualquier cosa que pueda verse mal.',
  checking: 'Revisando el color…',
  unavailable: 'La revisión del color aún no está disponible para esta foto.',
  mainColours: 'Colores principales',
  nothingToFix: 'No se ve nada mal en el color de esta pequeña vista previa.',
  watchOut: 'Atención:',
  tip: 'Consejo:',
  note: 'Nota:',
  family: {
    red: 'rojo', orange: 'naranja', brown: 'marrón', yellow: 'amarillo', lime: 'amarillo verdoso', green: 'verde', teal: 'verde azulado',
    blue: 'azul', purple: 'morado', pink: 'rosa', grey: 'gris', black: 'negro', white: 'blanco',
  },
  strength: { none: 'sin color', muted: 'suave', moderate: 'medio', strong: 'fuerte', veryStrong: 'muy fuerte' },
  share: (percent) => (percent >= 45 ? 'cerca de la mitad o más' : percent >= 25 ? 'cerca de un cuarto o más' : percent >= 10 ? 'una buena parte' : 'un poco'),
  paletteItem: (colour, strength, share) => `${colour}, ${strength}: ${share}`,
  and: (first, second) => `${first} y ${second}`,
  strongColour: (colours, percent) => `Un color muy intenso (${colours}) cubre el ${percent} % de la foto. Puede verse poco natural en pantalla e imprimirse mal.`,
  clippedColour: (colours) => `Algunas zonas en ${colours} son demasiado intensas para mostrar su detalle, así que se ven planas.`,
  cast: {
    warm: 'Lo que debería ser gris o blanco se ve un poco amarillo o naranja (un tono cálido).',
    cool: 'Lo que debería ser gris o blanco se ve un poco azul (un tono frío).',
    green: 'Lo que debería ser gris o blanco se ve un poco verde.',
    magenta: 'Lo que debería ser gris o blanco se ve un poco rosa o morado.',
  },
  castClear: 'El tono es tan evidente que la mayoría de la gente lo notará.',
  muted: 'Esta foto casi no tiene color. Está bien si la quiere casi en blanco y negro.',
  redGreen: (first, second) => `Las zonas en ${first} y en ${second} tienen un brillo parecido, así que a muchas personas con daltonismo les costará distinguirlas.`,
  redGreenHint: 'Hacer una de ellas más clara o más oscura ayuda a todo el mundo a ver la diferencia.',
  subject: (subjectColour, strength, surroundings) => `Su sujeto: ${subjectColour}, ${strength}. Alrededor: sobre todo ${surroundings}.`,
  editStronger: (percent) => `Su edición ha hecho los colores un ${percent} % más intensos que el original.`,
  editWeaker: (percent) => `Su edición ha hecho los colores un ${percent} % más suaves que el original.`,
  fixSoften: 'Suavizar el color',
  fixCooler: 'Hacer más frío',
  fixWarmer: 'Hacer más cálido',
  fixApplied: 'Hecho. Puede deshacerlo desde el historial de cambios.',
  findings: (count) => plural(count, { one: `${count} cosa que revisar`, other: `${count} cosas que revisar` }),
};
