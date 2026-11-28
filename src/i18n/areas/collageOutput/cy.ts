import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  size: `Maint allforio`,
  standard: (w: number, h: number) => `Safonol · ${w} × ${h} px`,
  double: (w: number, h: number) => `Dwywaith y maint · ${w} × ${h} px`,
  custom: `Ochr hir eich hun`,
  customEdge: `Ochr hir mewn picseli`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Cydraniad argraffu`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `PDF RGB ar gyfer labordy lluniau, ${dpi} PPI, gwaedu 3 mm a blychau tocio. Nid CMYK na PDF/X ardystiedig.`,
  windows: `Lluniau ym mhob ffenestr`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Tudalen ${page}, cefndir: ${filename}` : `Tudalen ${page}, ffenestr ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px yn y llun, wedi'i ddangos ar ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Wedi'i ddangos ar ${ww} × ${wh} px. Caiff maint y llun ei wirio pan gaiff y collage ei allforio.`,
  enlarged: (percent: number) => `Wedi'i chwyddo i ${percent}%, felly bydd yn edrych yn feddalach.`,
  sharp: `Digon o bicseli ar gyfer y maint hwn.`,
  ppi: (ppi: number) => `${ppi} picsel y fodfedd.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} picsel y fodfedd, o dan y ${dpi} DPI a ddewiswyd, felly bydd yn argraffu'n feddalach.`,
  lowSummary: (n: number) => plural(n, { one: `Mae gan ${n} ffenestr lai o bicseli nag sydd eu hangen ar gyfer y maint hwn. Dewiswch faint llai, neu allforiwch beth bynnag a bydd yn edrych yn feddalach.`, other: `Mae gan ${n} ffenestr lai o bicseli nag sydd eu hangen ar gyfer y maint hwn. Dewiswch faint llai, neu allforiwch beth bynnag a byddant yn edrych yn feddalach.` }),
  exportAnyway: (n: number) => plural(n, { one: `Allforio beth bynnag (${n} ffenestr feddalach)`, other: `Allforio beth bynnag (${n} ffenestr feddalach)` }),
  rawNote: `Mae InFlight yn datblygu lluniau RAW o ddata'r synhwyrydd, fel yn y golygydd; ni ddefnyddir rhagolygon mewnol y camera byth. Nid yw gwreiddiolion HEIF yn cael eu cefnogi mewn collage eto.`,
  heif: (filename: string) => `Ffeil HEIF yw ${filename}. Ni all collage wirio ei bicseli cydraniad llawn eto, felly ni roddwyd dim yn ei le.`,
  embedded: (filename: string) => `Nid oes gan ${filename} lun wedi'i ddatblygu o ddata'r synhwyrydd, ac ni ddefnyddir rhagolwg mewnol y camera byth mewn collage.`,
  done: `Collage wedi'i allforio. Mae eich gwreiddiolion heb eu newid.`,
  doneSoft: (n: number) => plural(n, { one: `Collage wedi'i allforio. Cafodd ${n} ffenestr ei chwyddo neu mae o dan y cydraniad argraffu, fel y dangoswyd cyn allforio. Mae eich gwreiddiolion heb eu newid.`, other: `Collage wedi'i allforio. Cafodd ${n} ffenestr eu chwyddo neu maent o dan y cydraniad argraffu, fel y dangoswyd cyn allforio. Mae eich gwreiddiolion heb eu newid.` }),
};
