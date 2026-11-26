import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  menu: (n: number) => `Unir ${n} fotos en una panorámica`,
  menuHint: "Une fotos que se solapan en una foto nueva y ancha, recortada solo a píxeles reales. Los originales no se modifican.",
  task: (n: number) => `Uniendo una panorámica de ${n} fotos`,
  reading: "Leyendo las fotos",
  matching: "Buscando dónde se solapan las fotos",
  placing: "Colocando las fotos",
  blending: "Fundiendo las uniones",
  saving: "Añadiendo la panorámica",
  done: (name: string, n: number) => `Se añadió ${name}, unida a partir de ${n} fotos. Sus fotos originales siguen intactas.`,
  cropNote: (percent: number) => `Recortada al ${percent} % de la zona unida que cubren píxeles reales. No se rellenó nada.`,
  cancelled: "Unión detenida. No se añadió nada. Sus fotos originales siguen intactas.",
  failed: "La panorámica no terminó. Abra Tareas para ver el motivo. Sus fotos originales siguen intactas.",
  tooFew: "Elija al menos dos fotos que se solapen. Sus fotos originales siguen intactas.",
  tooMany: (max: number) => `Elija como máximo ${max} fotos a la vez. Sus fotos originales siguen intactas.`,
  sizeMismatch: "Estas fotos tienen tamaños distintos, así que no se unieron. Sus fotos originales siguen intactas.",
  tooFlat: (n: number) => `La foto ${n} tiene muy poco detalle para alinearla, así que no se unió nada en lugar de adivinar. Sus fotos originales siguen intactas.`,
  unrelated: (n: number) => `La foto ${n} no se solapa lo suficiente con la anterior para alinearlas, así que no se unió nada. Elija las fotos en el orden en que las tomó, cada una solapando la siguiente en un tercio. Sus fotos originales siguen intactas.`,
  ambiguous: (n: number) => `No está claro dónde se une la foto ${n} con la anterior. El patrón se repite, o la cámara se inclinó demasiado, así que no se unió nada en lugar de adivinar. Sus fotos originales siguen intactas.`,
  vertical: "Estas fotos van de arriba abajo en lugar de lado a lado. Las panorámicas verticales aún no se admiten, así que no se unió nada. Sus fotos originales siguen intactas.",
  tooLarge: "Esta panorámica sería demasiado grande para crearla con seguridad en este dispositivo, y no se reduce sin preguntar. Elija menos fotos. Sus fotos originales siguen intactas.",
  noCoverage: "Las fotos no dejan un rectángulo cubierto por píxeles reales, así que no se unió nada en lugar de rellenar huecos. Sus fotos originales siguen intactas.",
  unsupported: (name: string) => `${name} no se puede leer a tamaño completo aquí, así que no se unió nada. No se usó una imagen más pequeña en su lugar. Sus fotos originales siguen intactas.`,
  rawNotDeveloped: (name: string) => `${name} todavía no tiene un revelado a tamaño completo de los datos del sensor, y la pequeña vista previa incrustada de la cámara no se usa para panorámicas. Haga primero el revelado a tamaño completo. Sus fotos originales siguen intactas.`,
  exposureDiffers: "Las fotos se tomaron con brillos bastante distintos. Se igualaron, pero revise si hay bandas en el cielo.",
  seamsVisible: "Puede que se noten algunas uniones: algo se movió entre fotos, o la cámara se desplazó en vez de girar.",
  focalEstimated: "La distancia focal del objetivo no estaba registrada, así que se calculó a partir de las fotos.",
  mainThread: "Se ejecutó en primer plano porque aquí no hay trabajo en segundo plano, así que la aplicación pudo detenerse a ratos.",
  infoTitle: "Panorámica",
  infoMadeFrom: (n: number) => plural(n, { one: `Unida a partir de ${n} foto:`, other: `Unida a partir de ${n} fotos:` }),
  infoHow: "Colocadas sobre un cilindro, uniones fundidas con suavidad y recortada a píxeles reales. No se generó ningún píxel.",
};
