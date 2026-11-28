import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  size: `Dimensione di esportazione`,
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Doppia dimensione · ${w} × ${h} px`,
  custom: `Lato lungo personalizzato`,
  customEdge: `Lato lungo in pixel`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Risoluzione di stampa`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `PDF RGB per laboratorio fotografico, ${dpi} PPI, abbondanza di 3 mm e riquadri di rifilo. Non CMYK né PDF/X certificato.`,
  windows: `Foto in ogni finestra`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Pagina ${page}, sfondo: ${filename}` : `Pagina ${page}, finestra ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px nella foto, mostrata a ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Mostrata a ${ww} × ${wh} px. La dimensione della foto viene verificata all'esportazione del collage.`,
  enlarged: (percent: number) => `Ingrandita al ${percent}%, quindi apparirà più morbida.`,
  sharp: `Pixel sufficienti per questa dimensione.`,
  ppi: (ppi: number) => `${ppi} pixel per pollice.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pixel per pollice, sotto i ${dpi} DPI scelti, quindi la stampa sarà più morbida.`,
  lowSummary: (n: number) => plural(n, { one: `${n} finestra ha meno pixel di quanti ne servano per questa dimensione. Scelga una dimensione più piccola, oppure esporti comunque e apparirà più morbida.`, other: `${n} finestre hanno meno pixel di quanti ne servano per questa dimensione. Scelga una dimensione più piccola, oppure esporti comunque e appariranno più morbide.` }),
  exportAnyway: (n: number) => plural(n, { one: `Esporta comunque (${n} finestra più morbida)`, other: `Esporta comunque (${n} finestre più morbide)` }),
  rawNote: `Le foto RAW vengono sviluppate da InFlight dai dati del sensore, come nell'editor; le anteprime incorporate della fotocamera non vengono mai usate. Gli originali HEIF non sono ancora supportati in un collage.`,
  heif: (filename: string) => `${filename} è un file HEIF. Un collage non può ancora verificare i suoi pixel a piena risoluzione, quindi non è stato messo nulla al suo posto.`,
  embedded: (filename: string) => `${filename} non ha un'immagine sviluppata dai dati del sensore, e in un collage non si usa mai un'anteprima incorporata della fotocamera.`,
  done: `Collage esportato. I Suoi originali sono invariati.`,
  doneSoft: (n: number) => plural(n, { one: `Collage esportato. ${n} finestra è stata ingrandita o è sotto la risoluzione di stampa, come mostrato prima dell'esportazione. I Suoi originali sono invariati.`, other: `Collage esportato. ${n} finestre sono state ingrandite o sono sotto la risoluzione di stampa, come mostrato prima dell'esportazione. I Suoi originali sono invariati.` }),
};
