import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  size: `Exportstorlek`,
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Dubbel storlek · ${w} × ${h} px`,
  custom: `Egen lång sida`,
  customEdge: `Lång sida i pixlar`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Utskriftsupplösning`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-PDF för fotolabb, ${dpi} PPI, 3 mm utfall och skärrutor. Inte CMYK eller certifierad PDF/X.`,
  windows: `Foton i varje fönster`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Sida ${page}, bakgrund: ${filename}` : `Sida ${page}, fönster ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px i fotot, visat i ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Visat i ${ww} × ${wh} px. Fotots storlek kontrolleras när collaget exporteras.`,
  enlarged: (percent: number) => `Förstorat till ${percent} %, så det ser mjukare ut.`,
  sharp: `Tillräckligt med pixlar för den här storleken.`,
  ppi: (ppi: number) => `${ppi} pixlar per tum.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pixlar per tum, under valda ${dpi} DPI, så utskriften blir mjukare.`,
  lowSummary: (n: number) => plural(n, { one: `${n} fönster har färre pixlar än den här storleken behöver. Välj en mindre storlek, eller exportera ändå så ser det mjukare ut.`, other: `${n} fönster har färre pixlar än den här storleken behöver. Välj en mindre storlek, eller exportera ändå så ser de mjukare ut.` }),
  exportAnyway: (n: number) => plural(n, { one: `Exportera ändå (${n} mjukare fönster)`, other: `Exportera ändå (${n} mjukare fönster)` }),
  rawNote: `RAW-foton framkallas av InFlight från sensordata, som i redigeraren; kamerans inbäddade förhandsvisningar används aldrig. HEIF-original stöds ännu inte i ett collage.`,
  heif: (filename: string) => `${filename} är en HEIF-fil. Ett collage kan ännu inte kontrollera dess pixlar i full upplösning, så inget sattes in i stället.`,
  embedded: (filename: string) => `${filename} har ingen bild framkallad från sensordata, och en inbäddad kameraförhandsvisning används aldrig i ett collage.`,
  done: `Collaget är exporterat. Dina original är oförändrade.`,
  doneSoft: (n: number) => plural(n, { one: `Collaget är exporterat. ${n} fönster förstorades eller ligger under utskriftsupplösningen, som visades före exporten. Dina original är oförändrade.`, other: `Collaget är exporterat. ${n} fönster förstorades eller ligger under utskriftsupplösningen, som visades före exporten. Dina original är oförändrade.` }),
};
