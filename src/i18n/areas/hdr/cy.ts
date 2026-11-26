import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  menu: (n: number) => `Cyfuno ${n} llun yn HDR`,
  menuHint: "Yn cyfuno cyfres o luniau tywyllach a goleuach yn llun 16-did newydd sy'n cadw'r uchafbwyntiau a'r cysgodion. Nid yw'r rhai gwreiddiol yn newid.",
  task: (n: number) => `Yn cyfuno ${n} llun yn HDR`,
  reading: "Yn darllen y lluniau",
  aligning: "Yn alinio'r lluniau",
  merging: "Yn cyfuno'r datguddiadau",
  saving: "Yn ychwanegu'r llun HDR",
  done: (name: string, n: number) => `Ychwanegwyd ${name}, wedi'i gyfuno o ${n} llun. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  cancelled: "Stopiwyd y cyfuno HDR. Ni ychwanegwyd dim. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  failed: "Ni orffennodd y cyfuno HDR. Agorwch Tasgau i weld pam. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooFew: "Dewiswch o leiaf ddau lun o'r un olygfa, wedi'u tynnu'n dywyllach ac yn oleuach, i'w cyfuno yn HDR. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooMany: (max: number) => `Dewiswch hyd at ${max} llun ar y tro i'w cyfuno yn HDR. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  sizeMismatch: "Mae'r lluniau hyn o feintiau gwahanol, felly ni ellir eu halinio. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  sameExposure: "Mae'n ymddangos bod gan y lluniau hyn yr un datguddiad, felly does dim i'w gyfuno. Dewiswch gyfres wedi'i thynnu'n dywyllach ac yn oleuach. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  unrelated: (n: number) => `Nid yw llun ${n} yn alinio'n ddigon clir â'r lleill, felly ni chyfunwyd dim yn hytrach na dyfalu. Dewiswch luniau o un gyfres. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  unsupported: (name: string) => `Ni ellir darllen ${name} yn ei faint llawn yma, felly ni chyfunwyd dim. Ni ddefnyddiwyd llun llai yn ei le. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  rawNotDeveloped: (name: string) => `Nid oedd modd datblygu ${name} ar 16 did o ddata'r synhwyrydd yma, ac ni ddefnyddir rhagolwg bach mewnol y camera ar gyfer HDR. Ailgysylltwch y gwreiddiol a rhowch gynnig arall arni. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  tooLarge: "Mae'r lluniau hyn yn rhy fawr i'w cyfuno'n ddiogel ar y ddyfais hon. Ni chyfunwyd dim. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  ghostsRemoved: "Symudodd rhywbeth rhwng y lluniau. Yno, mae'r cyfuno'n defnyddio un llun yn unig, fel nad oes dim yn ymddangos ddwywaith.",
  highlightsClipped: "Roedd rhai uchafbwyntiau'n rhy llachar hyd yn oed yn y llun tywyllaf, felly maen nhw'n aros yn wyn.",
  mainThread: "Rhedodd yn y blaendir am nad oes gwaith cefndir ar gael yma, felly efallai i'r ap oedi weithiau.",
  infoTitle: "Cyfuno HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Wedi'i wneud o ${n} llun:`, other: `Wedi'i wneud o ${n} llun:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stop`,
  infoHow: "Daw pob rhan o'r lluniau oedd wedi'u datguddio'n dda yno, wedi'u halinio a'u pwysoli yn ôl datguddiad, yna wedi'u haddasu gydag Uchafbwyntiau a Chysgodion y golygydd. Ni chrëwyd unrhyw bicseli.",
  whatIs: "Ystyr HDR yw ystod ddynamig uchel, nid diffiniad uchel. Mae'n cyfuno sawl datguddiad o'r un olygfa fel bod awyr lachar a chysgodion tywyll yn cadw eu manylion.",
  bracketTitle: "Cyfres datguddio",
  bracketFound: (n: number, stops: string) => `${n} llun wedi'u tynnu eiliadau ar wahân ar ddatguddiadau gwahanol (${stops} stop).`,
  bracketFromCamera: "Marciodd eich camera'r lluniau hyn fel cyfres datguddio.",
  bracketFromExposures: "Wedi'u canfod o'u cyflymder caead, agorfa ac ISO.",
};
