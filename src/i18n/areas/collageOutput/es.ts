import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish (usted). DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  size: `Tamaño de exportación`,
  standard: (w: number, h: number) => `Estándar · ${w} × ${h} px`,
  double: (w: number, h: number) => `El doble de tamaño · ${w} × ${h} px`,
  custom: `Lado largo personalizado`,
  customEdge: `Lado largo en píxeles`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Resolución de impresión`,
  dpiOption: (n: number) => `${n} PPP`,
  pdfNote: (dpi: number) => `PDF RGB para laboratorio fotográfico, ${dpi} PPP, sangrado de 3 mm y marcas de corte. No es CMYK ni PDF/X certificado.`,
  windows: `Fotos de cada ventana`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Página ${page}, fondo: ${filename}` : `Página ${page}, ventana ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px en la foto, mostrada a ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Mostrada a ${ww} × ${wh} px. El tamaño de la foto se comprueba al exportar el collage.`,
  enlarged: (percent: number) => `Ampliada al ${percent} %, así que se verá más suave.`,
  sharp: `Píxeles suficientes para este tamaño.`,
  ppi: (ppi: number) => `${ppi} píxeles por pulgada.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} píxeles por pulgada, por debajo de los ${dpi} PPP elegidos, así que se imprimirá más suave.`,
  lowSummary: (n: number) => plural(n, { one: `${n} ventana tiene menos píxeles de los que necesita este tamaño. Elija un tamaño menor o exporte de todos modos y se verá más suave.`, other: `${n} ventanas tienen menos píxeles de los que necesita este tamaño. Elija un tamaño menor o exporte de todos modos y se verán más suaves.` }),
  exportAnyway: (n: number) => plural(n, { one: `Exportar de todos modos (${n} ventana más suave)`, other: `Exportar de todos modos (${n} ventanas más suaves)` }),
  rawNote: `InFlight revela las fotos RAW a partir de los datos del sensor, como en el editor; nunca se usan las vistas previas integradas de la cámara. Los originales HEIF aún no se admiten en un collage.`,
  heif: (filename: string) => `${filename} es un archivo HEIF. Un collage aún no puede verificar sus píxeles a resolución completa, así que no se puso nada en su lugar.`,
  embedded: (filename: string) => `${filename} no tiene una imagen revelada a partir de los datos del sensor, y en un collage nunca se usa una vista previa integrada de la cámara.`,
  done: `Collage exportado. Sus originales no han cambiado.`,
  doneSoft: (n: number) => plural(n, { one: `Collage exportado. ${n} ventana se amplió o quedó por debajo de la resolución de impresión, como se mostró antes de exportar. Sus originales no han cambiado.`, other: `Collage exportado. ${n} ventanas se ampliaron o quedaron por debajo de la resolución de impresión, como se mostró antes de exportar. Sus originales no han cambiado.` }),
};
