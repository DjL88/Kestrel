import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  menu: (n: number) => `Pentyrru ffocws ${n} llun`,
  menuHint: "Yn cyfuno rhannau mwyaf miniog pob llun yn llun newydd. Ni chaiff y gwreiddiolion eu newid.",
  task: (n: number) => `Yn pentyrru ffocws ${n} llun`,
  reading: "Yn darllen y lluniau",
  aligning: "Yn alinio'r lluniau",
  blending: "Yn cyfuno'r rhannau mwyaf miniog",
  saving: "Yn ychwanegu'r llun wedi'i bentyrru",
  done: (name: string, n: number) => `Ychwanegwyd ${name}, wedi'i bentyrru o ${n} llun. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  cancelled: "Stopiwyd y pentyrru ffocws. Ni ychwanegwyd dim. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  failed: "Ni orffennodd y pentyrru ffocws. Agorwch Tasgau i weld pam. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooFew: "Dewiswch o leiaf ddau lun o'r un olygfa. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooMany: (max: number) => `Dewiswch hyd at ${max} llun ar y tro. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  sizeMismatch: "Mae'r lluniau hyn o feintiau gwahanol, felly ni ellir eu halinio. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  unrelated: (n: number) => `Nid yw llun ${n} yn edrych fel yr un olygfa â'i gymydog, felly ni phentyrrwyd dim. Dewiswch fframiau o un byrst. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  ambiguous: (n: number) => `Nid yw'n glir sut mae llun ${n} yn alinio â'i gymydog (mae'r patrwm yn ailadrodd, neu fe symudodd ormod), felly ni phentyrrwyd dim yn hytrach na dyfalu. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  tooFlat: (n: number) => `Mae gan lun ${n} rhy ychydig o fanylion i'w alinio, felly ni phentyrrwyd dim yn hytrach na dyfalu. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  unsupported: (name: string) => `Ni ellir darllen ${name} yn ei faint llawn yma, felly ni phentyrrwyd dim. Ni ddefnyddiwyd llun llai yn ei le. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  rawNotDeveloped: (name: string) => `Nid oes gan ${name} ddatblygiad maint llawn o ddata'r synhwyrydd eto, ac ni ddefnyddir rhagolwg bach mewnosodedig y camera. Gwnewch y datblygiad maint llawn yn gyntaf. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  tooLarge: "Mae'r lluniau hyn yn rhy fawr i'w pentyrru'n ddiogel ar y ddyfais hon. Ni phentyrrwyd dim. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  equallySharp: "Mae'r lluniau hyn yn edrych yr un mor finiog ym mhobman, felly efallai y bydd y pentwr yn debyg iawn i'r gwreiddiolion.",
  frameUnused: (n: number) => `Prin yr ychwanegodd llun ${n} ddim.`,
  oneFrameDominates: "Rhoddodd un llun bron yr holl fanylion. Gwiriwch fod y lluniau wedi'u tynnu ar bellteroedd ffocws gwahanol.",
  localFallback: (n: number) => `Dim ond fel cyfanwaith yr aliniwyd llun ${n}: roedd rhy ychydig o fanylion cyfatebol ar gyfer alinio manylach.`,
  infoTitle: "Pentwr ffocws",
  infoMadeFrom: (n: number) => plural(n, { one: `Wedi'i wneud o ${n} llun:`, other: `Wedi'i wneud o ${n} llun:` }),
  infoHow: "Daw pob rhan o'r llun mwyaf miniog yn y fan honno, wedi'i gyfuno'n llyfn. Ni chrëwyd unrhyw bicseli.",
};
