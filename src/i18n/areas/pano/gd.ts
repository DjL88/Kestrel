import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fuaigh ${n} dealbhan nan panorama`,
  menuHint: "Fuaighidh e dealbhan a tha a' dol thar a chèile ann an aon dealbh farsaing ùr, air a bhearradh gu piogsailean fìor. Chan atharraichear na tùsan.",
  task: (n: number) => `A' fuaigheal panorama à ${n} dealbhan`,
  reading: "A' leughadh nan dealbhan",
  matching: "A' lorg far a bheil na dealbhan a' dol thar a chèile",
  placing: "A' suidheachadh nan dealbhan",
  blending: "A' measgachadh nan tàthan",
  saving: "A' cur a' phanorama ris",
  done: (name: string, n: number) => `Chaidh ${name} a chur ris, air fhuaigheal à ${n} dealbhan. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  cropNote: (percent: number) => `Air a bhearradh gu ${percent}% den raon a tha fo phiogsailean fìor. Cha deach càil a lìonadh.`,
  cancelled: "Sguireadh den fhuaigheal. Cha deach càil a chur ris. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  failed: "Cha deach am panorama a chrìochnachadh. Fosgail Saothraichean airson an adhbhair. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooFew: "Tagh co-dhiù dà dhealbh a tha a' dol thar a chèile. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooMany: (max: number) => `Tagh suas ri ${max} dealbhan aig an aon àm. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  sizeMismatch: "Tha na dealbhan seo de mheudan eadar-dhealaichte, mar sin cha deach am fuaigheal. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooFlat: (n: number) => `Chan eil mion-fhiosrachadh gu leòr ann an dealbh ${n} airson a cho-thaobhadh, mar sin cha deach càil fhuaigheal seach tomhas. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  unrelated: (n: number) => `Chan eil dealbh ${n} a' dol thar an dealbh roimhe gu leòr airson an co-thaobhadh, mar sin cha deach càil fhuaigheal. Tagh na dealbhan san òrdugh san do thog thu iad, gach fear thar trian den ath fhear. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  ambiguous: (n: number) => `Chan eil e soilleir càite a bheil dealbh ${n} a' coinneachadh ris an dealbh roimhe. Tha am pàtran ag ath-aithris, no chlaon an camara cus, mar sin cha deach càil fhuaigheal seach tomhas. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  vertical: "Tha na dealbhan seo a' dol suas is sìos seach taobh ri taobh. Chan eil taic ri panoraman inghearach fhathast, mar sin cha deach càil fhuaigheal. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  tooLarge: "Bhiodh am panorama seo ro mhòr airson a dhèanamh gu sàbhailte air an uidheam seo, agus cha dèanar nas lugha e gun fhaighneachd. Tagh nas lugha de dhealbhan. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  noCoverage: "Chan fhàg na dealbhan ceart-cheàrnach fo phiogsailean fìor, mar sin cha deach càil fhuaigheal seach beàrnan a lìonadh. Tha na dealbhan tùsail agad gun bhuntainn riutha.",
  unsupported: (name: string) => `Chan urrainnear ${name} a leughadh aig làn-mheud an seo, mar sin cha deach càil fhuaigheal. Cha deach dealbh nas lugha a chleachdadh na àite. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  rawNotDeveloped: (name: string) => `Chan eil leasachadh làn-mheud bho dhàta an sensor aig ${name} fhathast, agus cha chleachdar an ro-shealladh beag a tha am broinn a' chamara airson panoraman. Dèan an leasachadh làn-mheud an toiseach. Tha na dealbhan tùsail agad gun bhuntainn riutha.`,
  exposureDiffers: "Chaidh na dealbhan a thogail le soilleireachd gu math eadar-dhealaichte. Chaidh an dèanamh nas co-ionnann, ach thoir sùil air na speuran airson bannan.",
  seamsVisible: "Dh'fhaodadh gum faicear cuid de na tàthan: ghluais rudeigin eadar dealbhan, no ghluais an camara seach tionndadh.",
  focalEstimated: "Cha deach fad fòcais an lionsa a chlàradh, mar sin chaidh obrachadh a-mach às na dealbhan.",
  mainThread: "Ruith e air a' bheulaibh oir chan eil obair sa chùlaibh ri fhaighinn an seo, mar sin dh'fhaodadh gun do stad an aplacaid uaireannan.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Air fhuaigheal à ${n} dealbh:`, other: `Air fhuaigheal à ${n} dealbhan:` }),
  infoHow: "Air an cur air siolandair, na tàthan air am measgachadh gu mìn agus air a bhearradh gu piogsailean fìor. Cha deach piogsail sam bith a ghintinn.",
};
