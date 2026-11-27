import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  title: "Thoir air falbh spotan",
  intro: "Falaichidh e dust, slatag no treamsgal mun spiris le piogsailean air an lethbhreacadh o fhaisg air làimh san aon dealbh. Chan eil dad ga chruthachadh, agus chan atharraichear am faidhle tùsail gu bràth.",
  start: "Cuir spotan",
  stop: "Deiseil",
  placing: "Briog no thoir gnogag air gach spot ri fhalach. Brùth Escape nuair a bhios tu deiseil.",
  size: "Meud",
  feather: "Buige",
  method: "Dòigh",
  heal: "Càraich: measgaich leis na tha mun cuairt",
  clone: "Clonaich: lethbhreac mionaideach",
  nextSource: "Dèan lethbhreac à àite eile",
  remove: "Thoir air falbh an spot",
  removeAll: "Thoir air falbh a h-uile spot",
  show: "Seall an spot",
  hide: "Falaich an spot",
  spot: (n: number) => `Spot ${n}`,
  hidden: "falaichte",
  count: (n: number) => plural(n, { one: `${n} spot`, other: `${n} spotan` }),
  empty: "Chan eil spot ann fhathast.",
  added: "Chaidh an spot fhalach. Slaod an cearcall briste, no tagh Dèan lethbhreac à àite eile, gus an tùs atharrachadh.",
  full: (n: number) => `Tha ${n} spotan aig an dealbh seo mar-thà, an àireamh as motha a tha ceadaichte.`,
  noSource: "Cha robh dad faisg air làimh coltach gu leòr airson lethbhreac a dhèanamh dheth. Feuch meud nas lugha.",
  unreadable: "Cha b' urrainn dhuinn an dealbh a leughadh an-dràsta, mar sin cha deach spot a chur ris.",
  noOther: "Chan eil àite eile faisg air làimh airson lethbhreac a dhèanamh dheth.",
  working: "A' lorg àite airson lethbhreac a dhèanamh dheth…",
  historyStep: "Càradh spotan",
  layer: "Spotan air an càradh",
  select: (n: number) => `Spot ${n}: tagh`,
  source: (n: number) => `Tùs spot ${n}: slaod no cleachd na h-iuchraichean saighde`,
};
