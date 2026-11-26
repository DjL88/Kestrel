import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  menu: (n: number) => `Co-aonaich ${n} dealbhan gu HDR`,
  menuHint: "Co-aonaichidh e sreath de dhealbhan nas dorcha is nas soilleire gu dealbh 16-biod ùr a chumas na solais àrda is na sgàilean. Cha tèid na tùsan atharrachadh.",
  task: (n: number) => `A' co-aonachadh ${n} dealbhan gu HDR`,
  reading: "A' leughadh nan dealbhan",
  aligning: "A' co-thaobhadh nan dealbhan",
  merging: "A' co-aonachadh nan deisearan",
  saving: "A' cur an deilbh HDR ris",
  done: (name: string, n: number) => `Chaidh ${name} a chur ris, air a cho-aonachadh à ${n} dealbhan. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  cancelled: "Sguireadh den cho-aonachadh HDR. Cha deach càil a chur ris. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  failed: "Cha deach an co-aonachadh HDR a chrìochnachadh. Fosgail Saothraichean airson an adhbhair. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooFew: "Tagh dà dhealbh co-dhiù den aon sealladh, air an togail nas dorcha is nas soilleire, airson HDR. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooMany: (max: number) => `Tagh suas ri ${max} dealbhan aig an aon àm airson HDR. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  sizeMismatch: "Tha na dealbhan seo de mheudan eadar-dhealaichte, mar sin chan urrainnear an co-thaobhadh. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  sameExposure: "Tha coltas gu bheil an aon deisearadh aig na dealbhan seo, mar sin chan eil càil ri cho-aonachadh. Tagh sreath air a togail nas dorcha is nas soilleire. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  unrelated: (n: number) => `Chan eil dealbh ${n} a' co-thaobhadh soilleir gu leòr ris an fheadhainn eile, mar sin cha deach càil a cho-aonachadh seach tomhas. Tagh dealbhan à aon sreath. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  unsupported: (name: string) => `Chan urrainnear ${name} a leughadh aig làn-mheud an seo, mar sin cha deach càil a cho-aonachadh. Cha deach dealbh nas lugha a chleachdadh na àite. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  rawNotDeveloped: (name: string) => `Cha b' urrainnear ${name} a leasachadh aig 16 biod o dhàta an sensor an seo, agus cha chleachdar ro-shealladh beag a' chamara airson HDR. Ceangail an tùs a-rithist is feuch ris a-rithist. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  tooLarge: "Tha na dealbhan seo ro mhòr airson an co-aonachadh gu sàbhailte air an uidheam seo. Cha deach càil a cho-aonachadh. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  ghostsRemoved: "Ghluais rudeigin eadar na dealbhan. An sin, cha chleachd an co-aonachadh ach aon dealbh, gus nach nochd càil dà thuras.",
  highlightsClipped: "Bha cuid de na solais àrda ro shoilleir fiù 's san dealbh as dorcha, mar sin fanaidh iad geal.",
  mainThread: "Ruith e air a' bheulaibh oir chan eil obair sa chùlaibh ri fhaighinn an seo, mar sin dh'fhaodadh gun do stad an aplacaid uaireannan.",
  infoTitle: "Co-aonachadh HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Air a dhèanamh à ${n} dealbh:`, other: `Air a dhèanamh à ${n} dealbhan:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} ceumannan`,
  infoHow: "Thig gach pàirt às na dealbhan a bha air an deisearadh gu math an sin, air an co-thaobhadh is air an cuideamachadh a rèir an deisearaidh. An uair sin, tha Solais àrda is Sgàilean an deasaiche gan gleusadh. Cha deach piogsail sam bith a chruthachadh.",
  whatIs: "Tha HDR a' ciallachadh raon dinamach àrd, chan e mìneachadh àrd. Co-aonaichidh e grunn dheisearan den aon sealladh gus an cum speuran soilleir is sgàilean dorcha am mion-fhiosrachadh.",
  bracketTitle: "Sreath deisearaidh",
  bracketFound: (n: number, stops: string) => `${n} dealbhan air an togail beagan às dèidh a chèile le deisearan eadar-dhealaichte (${stops} ceumannan).`,
  bracketFromCamera: "Chomharraich an camara agad na dealbhan seo mar shreath deisearaidh.",
  bracketFromExposures: "Air an lorg on astar còmhla, an fhosgladh is an ISO aca.",
};
