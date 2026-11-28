import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  size: `Exportformaat`,
  standard: (w: number, h: number) => `Standaard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Twee keer zo groot · ${w} × ${h} px`,
  custom: `Eigen lange zijde`,
  customEdge: `Lange zijde in pixels`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Afdrukresolutie`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-pdf voor fotolabs, ${dpi} PPI, 3 mm afloop en snijkaders. Geen CMYK of gecertificeerde PDF/X.`,
  windows: `Foto's in elk venster`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Pagina ${page}, achtergrond: ${filename}` : `Pagina ${page}, venster ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px in de foto, getoond op ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Getoond op ${ww} × ${wh} px. Het formaat van de foto wordt gecontroleerd bij het exporteren van de collage.`,
  enlarged: (percent: number) => `Vergroot tot ${percent}%, dus het ziet er zachter uit.`,
  sharp: `Genoeg pixels voor dit formaat.`,
  ppi: (ppi: number) => `${ppi} pixels per inch.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pixels per inch, onder de gekozen ${dpi} DPI, dus de afdruk wordt zachter.`,
  lowSummary: (n: number) => plural(n, { one: `${n} venster heeft minder pixels dan dit formaat nodig heeft. Kies een kleiner formaat, of exporteer toch en het ziet er zachter uit.`, other: `${n} vensters hebben minder pixels dan dit formaat nodig heeft. Kies een kleiner formaat, of exporteer toch en ze zien er zachter uit.` }),
  exportAnyway: (n: number) => plural(n, { one: `Toch exporteren (${n} zachter venster)`, other: `Toch exporteren (${n} zachtere vensters)` }),
  rawNote: `RAW-foto's worden door InFlight ontwikkeld uit de sensorgegevens, zoals in de editor; ingesloten cameravoorbeelden worden nooit gebruikt. HEIF-originelen worden in een collage nog niet ondersteund.`,
  heif: (filename: string) => `${filename} is een HEIF-bestand. Een collage kan de pixels op volledige resolutie nog niet controleren, dus er is niets voor in de plaats gezet.`,
  embedded: (filename: string) => `${filename} heeft geen beeld dat uit de sensorgegevens is ontwikkeld, en een ingesloten cameravoorbeeld wordt nooit in een collage gebruikt.`,
  done: `Collage geëxporteerd. Uw originelen zijn ongewijzigd.`,
  doneSoft: (n: number) => plural(n, { one: `Collage geëxporteerd. ${n} venster is vergroot of ligt onder de afdrukresolutie, zoals voor het exporteren getoond. Uw originelen zijn ongewijzigd.`, other: `Collage geëxporteerd. ${n} vensters zijn vergroot of liggen onder de afdrukresolutie, zoals voor het exporteren getoond. Uw originelen zijn ongewijzigd.` }),
};
