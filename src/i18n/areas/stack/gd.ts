import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  menu: (n: number) => `Cruach fòcas de ${n} dealbhan`,
  menuHint: "Cuiridh e na pàirtean as gèire de gach dealbh còmhla ann an dealbh ùr. Chan atharraichear na tùsan.",
  task: (n: number) => `A' cruachadh fòcas ${n} dealbhan`,
  reading: "A' leughadh nan dealbhan",
  aligning: "A' co-thaobhadh nan dealbhan",
  blending: "A' measgachadh nam pàirtean as gèire",
  saving: "A' cur ris an dealbh chruachte",
  done: (name: string, n: number) => `Chaidh ${name} a chur ris, air a chruachadh à ${n} dealbhan. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  cancelled: "Sguireadh den chruachadh fòcas. Cha deach càil a chur ris. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  failed: "Cha deach an cruachadh fòcas a chrìochnachadh. Fosgail Saothraichean airson an adhbhair. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooFew: "Tagh co-dhiù dà dhealbh den aon sealladh. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooMany: (max: number) => `Tagh suas ri ${max} dealbhan aig an aon àm. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  sizeMismatch: "Tha na dealbhan seo de mheudan eadar-dhealaichte, mar sin chan urrainnear an co-thaobhadh. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  unrelated: (n: number) => `Chan eil coltas gu bheil dealbh ${n} den aon sealladh ris an fhear ri thaobh, mar sin cha deach càil a chruachadh. Tagh frèamaichean à aon sreath. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  ambiguous: (n: number) => `Chan eil e soilleir mar a tha dealbh ${n} a' freagairt ris an fhear ri thaobh (tha am pàtran ag ath-aithris, no ghluais e cus), mar sin cha deach càil a chruachadh seach tomhas. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  tooFlat: (n: number) => `Tha ro bheag de mhion-fhiosrachadh ann an dealbh ${n} airson a cho-thaobhadh, mar sin cha deach càil a chruachadh seach tomhas. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  unsupported: (name: string) => `Chan urrainnear ${name} a leughadh aig làn-mheud an seo, mar sin cha deach càil a chruachadh. Cha deach dealbh nas lugha a chleachdadh na àite. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  rawNotDeveloped: (name: string) => `Chan eil leasachadh làn-mheud bho dhàta an sensor aig ${name} fhathast, agus cha chleachdar an ro-shealladh beag a tha am broinn a' chamara. Dèan an leasachadh làn-mheud an toiseach. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  tooLarge: "Tha na dealbhan seo ro mhòr airson an cruachadh gu sàbhailte air an uidheam seo. Cha deach càil a chruachadh. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  equallySharp: "Tha coltas cho geur air na dealbhan seo anns gach àite, mar sin dh'fhaodadh an cruach a bhith glè choltach ris na tùsan.",
  frameUnused: (n: number) => `Cha mhòr nach do chuir dealbh ${n} càil ris.`,
  oneFrameDominates: "Thug aon dealbh cha mhòr am mion-fhiosrachadh gu lèir. Dèan cinnteach gun deach na dealbhan a thogail aig astaran fòcais eadar-dhealaichte.",
  localFallback: (n: number) => `Cha deach dealbh ${n} a cho-thaobhadh ach mar aon: bha ro bheag de mhion-fhiosrachadh co-ionann ann airson co-thaobhadh nas mionaidiche.`,
  infoTitle: "Cruach fòcas",
  infoMadeFrom: (n: number) => plural(n, { one: `Air a dhèanamh à ${n} dealbh:`, other: `Air a dhèanamh à ${n} dealbhan:` }),
  infoHow: "Tha gach pàirt a' tighinn bhon dealbh as gèire san àite sin, air a mheasgachadh gu mìn. Cha deach piogsail sam bith a ghintinn.",
};
