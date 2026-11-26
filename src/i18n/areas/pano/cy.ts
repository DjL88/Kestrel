import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  menu: (n: number) => `Pwytho ${n} llun yn banorama`,
  menuHint: "Yn uno lluniau sy'n gorgyffwrdd yn un llun llydan newydd, wedi'i docio i bicseli go iawn. Ni chaiff y gwreiddiolion eu newid.",
  task: (n: number) => `Yn pwytho panorama o ${n} llun`,
  reading: "Yn darllen y lluniau",
  matching: "Yn chwilio lle mae'r lluniau'n gorgyffwrdd",
  placing: "Yn gosod y lluniau",
  blending: "Yn cymysgu'r uniadau",
  saving: "Yn ychwanegu'r panorama",
  done: (name: string, n: number) => `Ychwanegwyd ${name}, wedi'i bwytho o ${n} llun. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  cropNote: (percent: number) => `Wedi'i docio i'r ${percent}% o'r ardal sydd dan bicseli go iawn. Ni lenwyd dim byd.`,
  cancelled: "Stopiwyd y pwytho. Ni ychwanegwyd dim. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  failed: "Ni orffennodd y panorama. Agorwch Tasgau i weld pam. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooFew: "Dewiswch o leiaf ddau lun sy'n gorgyffwrdd. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooMany: (max: number) => `Dewiswch hyd at ${max} llun ar y tro. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  sizeMismatch: "Mae'r lluniau hyn o feintiau gwahanol, felly ni chawsant eu pwytho. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooFlat: (n: number) => `Does gan lun ${n} ddim digon o fanylion i'w alinio, felly ni phwythwyd dim yn hytrach na dyfalu. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  unrelated: (n: number) => `Nid yw llun ${n} yn gorgyffwrdd digon â'r llun blaenorol i'w halinio, felly ni phwythwyd dim. Dewiswch y lluniau yn y drefn y'u tynnwyd, pob un yn gorgyffwrdd tua thraean â'r nesaf. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  ambiguous: (n: number) => `Nid yw'n glir lle mae llun ${n} yn ymuno â'r llun blaenorol. Mae'r patrwm yn ailadrodd, neu gogwyddodd y camera ormod, felly ni phwythwyd dim yn hytrach na dyfalu. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  vertical: "Mae'r lluniau hyn yn mynd i fyny ac i lawr yn hytrach nag o ochr i ochr. Ni chefnogir panoramâu fertigol eto, felly ni phwythwyd dim. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  tooLarge: "Byddai'r panorama hwn yn rhy fawr i'w wneud yn ddiogel ar y ddyfais hon, ac ni chaiff ei wneud yn llai heb ofyn. Dewiswch lai o luniau. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  noCoverage: "Nid yw'r lluniau'n gadael petryal dan bicseli go iawn, felly ni phwythwyd dim yn hytrach na llenwi bylchau. Mae eich lluniau gwreiddiol heb eu cyffwrdd.",
  unsupported: (name: string) => `Ni ellir darllen ${name} yn ei faint llawn yma, felly ni phwythwyd dim. Ni ddefnyddiwyd llun llai yn ei le. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  rawNotDeveloped: (name: string) => `Nid oes gan ${name} ddatblygiad maint llawn o ddata'r synhwyrydd eto, ac ni ddefnyddir rhagolwg bach mewnosodedig y camera ar gyfer panoramâu. Gwnewch y datblygiad maint llawn yn gyntaf. Mae eich lluniau gwreiddiol heb eu cyffwrdd.`,
  exposureDiffers: "Tynnwyd y lluniau gyda disgleirdeb go wahanol. Cawsant eu gwastatáu, ond gwiriwch yr awyr am fandiau.",
  seamsVisible: "Efallai y bydd rhai uniadau i'w gweld: symudodd rhywbeth rhwng lluniau, neu symudodd y camera yn hytrach na throi.",
  focalEstimated: "Ni chofnodwyd hyd ffocal y lens, felly cafodd ei gyfrifo o'r lluniau.",
  mainThread: "Rhedodd yn y blaendir am nad oes gwaith cefndir ar gael yma, felly efallai i'r ap oedi weithiau.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Wedi'i bwytho o ${n} llun:`, other: `Wedi'i bwytho o ${n} llun:` }),
  infoHow: "Wedi'u gosod ar silindr, uniadau wedi'u cymysgu'n llyfn ac wedi'i docio i bicseli go iawn. Ni chrëwyd unrhyw bicseli.",
};
