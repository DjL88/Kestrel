import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  title: "Corrección de manchas",
  intro: "Cubre polvo, una ramita o un posadero molesto con píxeles copiados de una zona cercana de la misma foto. No se inventa nada y el archivo original nunca se modifica.",
  start: "Marcar manchas",
  stop: "Listo",
  placing: "Haga clic o toque cada mancha que quiera cubrir. Pulse Escape cuando termine.",
  size: "Tamaño",
  feather: "Suavidad",
  method: "Método",
  heal: "Corregir: fundir con el entorno",
  clone: "Clonar: copia exacta",
  nextSource: "Copiar de otro sitio",
  remove: "Quitar mancha",
  removeAll: "Quitar todas las manchas",
  show: "Mostrar mancha",
  hide: "Ocultar mancha",
  spot: (n: number) => `Mancha ${n}`,
  hidden: "oculta",
  count: (n: number) => plural(n, { one: `${n} mancha`, other: `${n} manchas` }),
  empty: "Aún no hay manchas.",
  added: "Mancha cubierta. Arrastre el círculo discontinuo, o elija Copiar de otro sitio, para cambiar de dónde se copia.",
  full: (n: number) => `Esta foto ya tiene ${n} manchas, el máximo permitido.`,
  noSource: "No había nada cercano lo bastante parecido para copiar. Pruebe un tamaño más pequeño.",
  unreadable: "No se pudo leer la foto en este momento, así que no se añadió ninguna mancha.",
  noOther: "No hay otro sitio cercano del que copiar.",
  working: "Buscando un sitio del que copiar…",
  historyStep: "Corrección de manchas",
  layer: "Manchas corregidas",
  select: (n: number) => `Mancha ${n}: seleccionar`,
  source: (n: number) => `Origen de la mancha ${n}: arrastre o use las flechas`,
};
