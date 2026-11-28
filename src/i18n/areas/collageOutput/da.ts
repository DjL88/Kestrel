import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  size: `Eksportstørrelse`,
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Dobbelt størrelse · ${w} × ${h} px`,
  custom: `Egen lang side`,
  customEdge: `Lang side i pixel`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Udskriftsopløsning`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-PDF til fotolaboratorier, ${dpi} PPI, 3 mm beskæring og skærebokse. Ikke CMYK eller certificeret PDF/X.`,
  windows: `Fotos i hvert vindue`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Side ${page}, baggrund: ${filename}` : `Side ${page}, vindue ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px i fotoet, vist i ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Vist i ${ww} × ${wh} px. Fotoets størrelse kontrolleres, når collagen eksporteres.`,
  enlarged: (percent: number) => `Forstørret til ${percent} %, så det ser blødere ud.`,
  sharp: `Pixel nok til denne størrelse.`,
  ppi: (ppi: number) => `${ppi} pixel pr. tomme.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pixel pr. tomme, under de valgte ${dpi} DPI, så udskriften bliver blødere.`,
  lowSummary: (n: number) => plural(n, { one: `${n} vindue har færre pixel, end denne størrelse kræver. Vælg en mindre størrelse, eller eksportér alligevel, så ser det blødere ud.`, other: `${n} vinduer har færre pixel, end denne størrelse kræver. Vælg en mindre størrelse, eller eksportér alligevel, så ser de blødere ud.` }),
  exportAnyway: (n: number) => plural(n, { one: `Eksportér alligevel (${n} blødere vindue)`, other: `Eksportér alligevel (${n} blødere vinduer)` }),
  rawNote: `RAW-fotos fremkaldes af InFlight fra sensordataene, som i editoren; kameraets indlejrede forhåndsvisninger bruges aldrig. HEIF-originaler understøttes endnu ikke i en collage.`,
  heif: (filename: string) => `${filename} er en HEIF-fil. En collage kan endnu ikke kontrollere dens pixel i fuld opløsning, så intet blev sat i stedet.`,
  embedded: (filename: string) => `${filename} har intet billede fremkaldt fra sensordataene, og en indlejret kameraforhåndsvisning bruges aldrig i en collage.`,
  done: `Collagen er eksporteret. Dine originaler er uændrede.`,
  doneSoft: (n: number) => plural(n, { one: `Collagen er eksporteret. ${n} vindue blev forstørret eller ligger under udskriftsopløsningen, som vist før eksporten. Dine originaler er uændrede.`, other: `Collagen er eksporteret. ${n} vinduer blev forstørret eller ligger under udskriftsopløsningen, som vist før eksporten. Dine originaler er uændrede.` }),
};
