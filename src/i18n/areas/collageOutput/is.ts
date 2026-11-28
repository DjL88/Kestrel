import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  size: `Útflutningsstærð`,
  standard: (w: number, h: number) => `Venjuleg · ${w} × ${h} px`,
  double: (w: number, h: number) => `Tvöföld stærð · ${w} × ${h} px`,
  custom: `Sérsniðin löng hlið`,
  customEdge: `Löng hlið í dílum`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Prentupplausn`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-PDF fyrir ljósmyndastofu, ${dpi} PPI, 3 mm blæðing og skurðarrammar. Ekki CMYK eða vottað PDF/X.`,
  windows: `Myndir í hverjum glugga`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Síða ${page}, bakgrunnur: ${filename}` : `Síða ${page}, gluggi ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px í myndinni, sýnd í ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Sýnd í ${ww} × ${wh} px. Stærð myndarinnar er athuguð þegar klippimyndin er flutt út.`,
  enlarged: (percent: number) => `Stækkuð í ${percent}%, svo hún verður mýkri.`,
  sharp: `Nægir dílar fyrir þessa stærð.`,
  ppi: (ppi: number) => `${ppi} dílar á tommu.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} dílar á tommu, undir völdum ${dpi} DPI, svo prentunin verður mýkri.`,
  lowSummary: (n: number) => plural(n, { one: `${n} gluggi hefur færri díla en þessi stærð þarf. Veldu minni stærð eða fluttu út samt og hann verður mýkri.`, other: `${n} gluggar hafa færri díla en þessi stærð þarf. Veldu minni stærð eða fluttu út samt og þeir verða mýkri.` }),
  exportAnyway: (n: number) => plural(n, { one: `Flytja út samt (${n} mýkri gluggi)`, other: `Flytja út samt (${n} mýkri gluggar)` }),
  rawNote: `InFlight framkallar RAW-myndir úr gögnum myndflögunnar, eins og í ritlinum; innbyggðar forskoðanir myndavélarinnar eru aldrei notaðar. HEIF-frumrit eru ekki enn studd í klippimynd.`,
  heif: (filename: string) => `${filename} er HEIF-skrá. Klippimynd getur ekki enn staðfest díla hennar í fullri upplausn, svo ekkert var sett í staðinn.`,
  embedded: (filename: string) => `${filename} hefur enga mynd framkallaða úr gögnum myndflögunnar, og innbyggð forskoðun myndavélarinnar er aldrei notuð í klippimynd.`,
  done: `Klippimynd flutt út. Frumritin þín eru óbreytt.`,
  doneSoft: (n: number) => plural(n, { one: `Klippimynd flutt út. ${n} gluggi var stækkaður eða er undir prentupplausn, eins og sýnt var fyrir útflutning. Frumritin þín eru óbreytt.`, other: `Klippimynd flutt út. ${n} gluggar voru stækkaðir eða eru undir prentupplausn, eins og sýnt var fyrir útflutning. Frumritin þín eru óbreytt.` }),
};
