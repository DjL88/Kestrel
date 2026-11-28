import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  size: `Eksportstørrelse`,
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Dobbel størrelse · ${w} × ${h} px`,
  custom: `Egen lang side`,
  customEdge: `Lang side i piksler`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Utskriftsoppløsning`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-PDF for fotolaboratorier, ${dpi} PPI, 3 mm utfallende og skjærebokser. Ikke CMYK eller sertifisert PDF/X.`,
  windows: `Bilder i hvert vindu`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Side ${page}, bakgrunn: ${filename}` : `Side ${page}, vindu ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px i bildet, vist i ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Vist i ${ww} × ${wh} px. Bildets størrelse kontrolleres når collagen eksporteres.`,
  enlarged: (percent: number) => `Forstørret til ${percent} %, så det ser mykere ut.`,
  sharp: `Nok piksler for denne størrelsen.`,
  ppi: (ppi: number) => `${ppi} piksler per tomme.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} piksler per tomme, under valgte ${dpi} DPI, så utskriften blir mykere.`,
  lowSummary: (n: number) => plural(n, { one: `${n} vindu har færre piksler enn denne størrelsen trenger. Velg en mindre størrelse, eller eksporter likevel, så ser det mykere ut.`, other: `${n} vinduer har færre piksler enn denne størrelsen trenger. Velg en mindre størrelse, eller eksporter likevel, så ser de mykere ut.` }),
  exportAnyway: (n: number) => plural(n, { one: `Eksporter likevel (${n} mykere vindu)`, other: `Eksporter likevel (${n} mykere vinduer)` }),
  rawNote: `RAW-bilder fremkalles av InFlight fra sensordataene, som i redigeringen; kameraets innebygde forhåndsvisninger brukes aldri. HEIF-originaler støttes ennå ikke i en collage.`,
  heif: (filename: string) => `${filename} er en HEIF-fil. En collage kan ennå ikke kontrollere pikslene i full oppløsning, så ingenting ble satt inn i stedet.`,
  embedded: (filename: string) => `${filename} har ikke noe bilde fremkalt fra sensordataene, og en innebygd forhåndsvisning fra kameraet brukes aldri i en collage.`,
  done: `Collagen er eksportert. Originalene dine er uendret.`,
  doneSoft: (n: number) => plural(n, { one: `Collagen er eksportert. ${n} vindu ble forstørret eller ligger under utskriftsoppløsningen, som vist før eksporten. Originalene dine er uendret.`, other: `Collagen er eksportert. ${n} vinduer ble forstørret eller ligger under utskriftsoppløsningen, som vist før eksporten. Originalene dine er uendret.` }),
};
