import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  title: "Golygon wedi’u cadw",
  hint: "Wedi’u cadw ar y ddyfais hon yn unig. Mae golwg yn newid pa luniau sy’n cael eu dangos, byth y lluniau eu hunain.",
  none: "Dim golygon wedi’u cadw eto. Dewiswch hidlwyr, yna’u cadw yma gydag enw.",
  show: (name: string) => `Dangos ${name}`,
  remove: (name: string) => `Dileu’r olwg ${name}`,
  nameLabel: "Enw ar gyfer yr hidlwyr hyn",
  save: "Cadw’r olwg",
  saved: (name: string) => `Wedi cadw’r olwg ${name}.`,
  replaced: (name: string) => `Wedi diweddaru’r olwg ${name}.`,
  emptyName: "Teipiwch enw ar gyfer yr olwg yn gyntaf.",
  full: (max: number) => `Gallwch gadw hyd at ${max} golwg. Dilëwch un yn gyntaf.`,
  notStored: "Wnaeth y ddyfais hon ddim cadw’r olwg, felly bydd wedi mynd pan fydd InFlight yn cau.",
  showing: (name: string) => `Yn dangos yr olwg ${name}`,
  noneAhead: "Dim mwy o luniau i’w hadolygu ar ôl hwn yn y lluniau a ddangosir.",
  noneBehind: "Dim lluniau i’w hadolygu cyn hwn yn y lluniau a ddangosir.",
};
