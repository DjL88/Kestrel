import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  title: "Seallaidhean glèidhte",
  hint: "Air an glèidheadh air an uidheam seo a-mhàin. Atharraichidh sealladh dè na dealbhan a chithear, chan ann na dealbhan fhèin.",
  none: "Chan eil sealladh glèidhte ann fhathast. Tagh criathragan is glèidh iad an-seo le ainm.",
  show: (name: string) => `Seall ${name}`,
  remove: (name: string) => `Sguab às an sealladh glèidhte ${name}`,
  nameLabel: "Ainm nan criathragan seo",
  save: "Glèidh an sealladh",
  saved: (name: string) => `Chaidh an sealladh ${name} a ghlèidheadh.`,
  replaced: (name: string) => `Chaidh an sealladh ${name} ùrachadh.`,
  emptyName: "Sgrìobh ainm airson an t-seallaidh an toiseach.",
  full: (max: number) => `’S urrainn dhut suas ri ${max} seallaidhean a ghlèidheadh. Sguab fear às an toiseach.`,
  notStored: "Cha do ghlèidh an uidheam seo an sealladh, mar sin bidh e air falbh nuair a dhùineas InFlight.",
  showing: (name: string) => `A’ sealltainn an t-seallaidh ghlèidhte ${name}`,
  noneAhead: "Chan eil barrachd dhealbhan ri an sgrùdadh às dèidh an fhir seo am measg na feadhainn a chithear.",
  noneBehind: "Chan eil dealbhan ri an sgrùdadh ron fhear seo am measg na feadhainn a chithear.",
};
