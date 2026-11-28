import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  paint: `Pintar`,
  erase: `Borrar`,
  mode: `Modo del pincel`,
  size: `Tamaño del pincel`,
  stop: `Dejar de pintar`,
  layer: (name: string) => `Pincel sobre ${name}`,
  help: `Arrastre sobre la foto para pintar. Mantenga Alt pulsada para borrar un momento. Pulse [ o ] para cambiar el tamaño. Con el teclado, las flechas mueven el pincel y la barra espaciadora pinta.`,
  painting: (name: string) => `Pintando sobre ${name}. Sus ajustes se aplican donde pinta.`,
  erasing: (name: string) => `Borrando de ${name}. Sus ajustes dejan de aplicarse donde borra.`,
  added: `Máscara de pincel añadida. Arrastre sobre la foto para pintar donde se aplican sus ajustes.`,
  pickMask: `Abra una máscara de pincel, de sujeto o de fondo en la lista de abajo y pinte sobre la foto para ampliarla o borrarla.`,
  refine: `El pincel y el borrador también afinan una máscara de sujeto o de fondo: ábrala en la lista y pinte para añadir o borre para quitar.`,
  full: (n: number) => `Esta máscara ya tiene ${n} trazos de pincel, el máximo. Añada otra máscara de pincel para seguir pintando.`,
  strokes: (n: number) => plural(n, { one: `${n} trazo de pincel`, other: `${n} trazos de pincel` }),
  unavailable: `Pintar es una vista previa. Active Pincel de máscara en Funciones en vista previa para usarlo.`,
};
