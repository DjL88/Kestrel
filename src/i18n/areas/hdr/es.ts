import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  menu: (n: number) => `Combinar ${n} fotos en HDR`,
  menuHint: "Combina una serie de fotos más oscuras y más claras en una foto nueva de 16 bits que conserva las luces y las sombras. Los originales no se modifican.",
  task: (n: number) => `Combinando ${n} fotos en HDR`,
  reading: "Leyendo las fotos",
  aligning: "Alineando las fotos",
  merging: "Combinando las exposiciones",
  saving: "Añadiendo la foto HDR",
  done: (name: string, n: number) => `Se añadió ${name}, combinada a partir de ${n} fotos. Sus fotos originales siguen intactas.`,
  cancelled: "Combinación HDR detenida. No se añadió nada. Sus fotos originales siguen intactas.",
  failed: "La combinación HDR no terminó. Abra Tareas para ver el motivo. Sus fotos originales siguen intactas.",
  tooFew: "Elija al menos dos fotos de la misma escena, tomadas más oscuras y más claras, para combinar en HDR. Sus fotos originales siguen intactas.",
  tooMany: (max: number) => `Elija como máximo ${max} fotos a la vez para combinar en HDR. Sus fotos originales siguen intactas.`,
  sizeMismatch: "Estas fotos tienen tamaños distintos, así que no se pueden alinear. Sus fotos originales siguen intactas.",
  sameExposure: "Estas fotos parecen tener la misma exposición, así que no hay nada que combinar. Elija una serie tomada más oscura y más clara. Sus fotos originales siguen intactas.",
  unrelated: (n: number) => `La foto ${n} no se alinea con las demás con suficiente claridad, así que no se combinó nada en lugar de adivinar. Elija fotos de una misma serie. Sus fotos originales siguen intactas.`,
  unsupported: (name: string) => `${name} no se puede leer a tamaño completo aquí, así que no se combinó nada. No se usó una imagen más pequeña en su lugar. Sus fotos originales siguen intactas.`,
  rawNotDeveloped: (name: string) => `${name} no se pudo revelar a 16 bits desde sus datos del sensor aquí, y la pequeña vista previa integrada de la cámara no se usa para HDR. Vuelva a conectar el original e inténtelo de nuevo. Sus fotos originales siguen intactas.`,
  tooLarge: "Estas fotos son demasiado grandes para combinarlas con seguridad en este dispositivo. No se combinó nada. Sus fotos originales siguen intactas.",
  ghostsRemoved: "Algo se movió entre las fotos. Allí, la combinación usa una sola foto, para que nada aparezca dos veces.",
  highlightsClipped: "Algunas luces eran demasiado claras incluso en la foto más oscura, así que siguen en blanco.",
  mainThread: "Se ejecutó en primer plano porque aquí no hay trabajo en segundo plano, así que la aplicación pudo detenerse a ratos.",
  infoTitle: "Combinación HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Hecha a partir de ${n} foto:`, other: `Hecha a partir de ${n} fotos:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} pasos`,
  infoHow: "Cada zona viene de las fotos bien expuestas en ese punto, alineadas y ponderadas por exposición, y luego ajustadas con las Luces y las Sombras del editor. No se generó ningún píxel.",
  whatIs: "HDR significa alto rango dinámico, no alta definición. Combina varias exposiciones de la misma escena para que los cielos claros y las sombras oscuras conserven el detalle.",
  bracketTitle: "Serie de exposiciones",
  bracketFound: (n: number, stops: string) => `${n} fotos tomadas con instantes de diferencia y exposiciones distintas (${stops} pasos).`,
  bracketFromCamera: "Su cámara marcó estas fotos como una serie de exposiciones.",
  bracketFromExposures: "Encontradas por su velocidad, apertura e ISO.",
};
