import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  menu: (n: number) => `Apilar el enfoque de ${n} fotos`,
  menuHint: "Combina las partes más nítidas de cada foto en una foto nueva. Los originales no se modifican.",
  task: (n: number) => `Apilando el enfoque de ${n} fotos`,
  reading: "Leyendo las fotos",
  aligning: "Alineando las fotos",
  blending: "Combinando las partes más nítidas",
  saving: "Añadiendo la foto apilada",
  done: (name: string, n: number) => `Se añadió ${name}, apilada a partir de ${n} fotos. Sus fotos originales siguen intactas.`,
  cancelled: "Apilado detenido. No se añadió nada. Sus fotos originales siguen intactas.",
  failed: "El apilado no terminó. Abra Tareas para ver el motivo. Sus fotos originales siguen intactas.",
  tooFew: "Elija al menos dos fotos de la misma escena. Sus fotos originales siguen intactas.",
  tooMany: (max: number) => `Elija como máximo ${max} fotos a la vez. Sus fotos originales siguen intactas.`,
  sizeMismatch: "Estas fotos tienen tamaños distintos, así que no se pueden alinear. Sus fotos originales siguen intactas.",
  unrelated: (n: number) => `La foto ${n} no parece la misma escena que su vecina, así que no se apiló nada. Elija fotogramas de una misma ráfaga. Sus fotos originales siguen intactas.`,
  ambiguous: (n: number) => `No está claro cómo se alinea la foto ${n} con su vecina (el patrón se repite o se movió demasiado), así que no se apiló nada en lugar de adivinar. Sus fotos originales siguen intactas.`,
  tooFlat: (n: number) => `La foto ${n} tiene muy poco detalle para alinearla, así que no se apiló nada en lugar de adivinar. Sus fotos originales siguen intactas.`,
  unsupported: (name: string) => `${name} no se puede leer a tamaño completo aquí, así que no se apiló nada. No se usó una imagen más pequeña en su lugar. Sus fotos originales siguen intactas.`,
  rawNotDeveloped: (name: string) => `${name} todavía no tiene un revelado a tamaño completo de los datos del sensor, y la pequeña vista previa incrustada de la cámara no se usa para apilar. Haga primero el revelado a tamaño completo. Sus fotos originales siguen intactas.`,
  tooLarge: "Estas fotos son demasiado grandes para apilarlas con seguridad en este dispositivo. No se apiló nada. Sus fotos originales siguen intactas.",
  equallySharp: "Estas fotos parecen igual de nítidas en todas partes, así que el resultado puede parecerse mucho a los originales.",
  frameUnused: (n: number) => `La foto ${n} apenas aportó nada al apilado.`,
  oneFrameDominates: "Una sola foto aportó casi todo el detalle. Compruebe que las fotos se tomaron a distancias de enfoque diferentes.",
  localFallback: (n: number) => `La foto ${n} solo se alineó en conjunto: tenía muy poco detalle coincidente para un ajuste más fino.`,
  infoTitle: "Apilado de enfoque",
  infoMadeFrom: (n: number) => plural(n, { one: `Hecha a partir de ${n} foto:`, other: `Hecha a partir de ${n} fotos:` }),
  infoHow: "Cada parte procede de la foto más nítida en ese lugar, combinada con suavidad. No se generó ningún píxel.",
};
