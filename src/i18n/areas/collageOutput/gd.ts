import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  size: `Meud às-phortaidh`,
  standard: (w: number, h: number) => `Àbhaisteach · ${w} × ${h} px`,
  double: (w: number, h: number) => `Dà uiread de mheud · ${w} × ${h} px`,
  custom: `Taobh fada gnàthaichte`,
  customEdge: `An taobh fada ann am piogsailean`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Dùmhlachd clò-bhualaidh`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `PDF RGB airson obair-lann dhealbhan, ${dpi} PPI, bleed 3 mm is bogsaichean bearraidh. Chan e CMYK no PDF/X dearbhte a th’ ann.`,
  windows: `Dealbhan anns gach uinneag`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Duilleag ${page}, cùlaibh: ${filename}` : `Duilleag ${page}, uinneag ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px san dealbh, ga shealltainn aig ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Ga shealltainn aig ${ww} × ${wh} px. Thèid meud an deilbh a dhearbhadh nuair a thèid an co-chruinneachadh às-phortadh.`,
  enlarged: (percent: number) => `Air a mheudachadh gu ${percent}%, mar sin bidh e nas buige.`,
  sharp: `Gu leòr phiogsailean airson a' mheud seo.`,
  ppi: (ppi: number) => `${ppi} piogsail san òirleach.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} piogsail san òirleach, nas lugha na na ${dpi} DPI a thagh thu, mar sin bidh an clò-bhualadh nas buige.`,
  lowSummary: (n: number) => plural(n, { one: `Tha nas lugha de phiogsailean aig ${n} uinneag na tha a dhìth air a' mheud seo. Tagh meud nas lugha, no às-phortaich co-dhiù agus bidh i nas buige.`, other: `Tha nas lugha de phiogsailean aig ${n} uinneagan na tha a dhìth air a' mheud seo. Tagh meud nas lugha, no às-phortaich co-dhiù agus bidh iad nas buige.` }),
  exportAnyway: (n: number) => plural(n, { one: `Às-phortaich co-dhiù (${n} uinneag nas buige)`, other: `Às-phortaich co-dhiù (${n} uinneagan nas buige)` }),
  rawNote: `Leasaichidh InFlight dealbhan RAW o dhàta a' mhothaicheir, mar san deasaiche; cha chleachdar ro-shealladh a' chamara a-riamh. Chan eil taic ri dealbhan tùsail HEIF ann an co-chruinneachadh fhathast.`,
  heif: (filename: string) => `'S e faidhle HEIF a th' ann an ${filename}. Chan urrainn do cho-chruinneachadh na piogsailean làn-dùmhlachd aige a dhearbhadh fhathast, mar sin cha deach dad a chur na àite.`,
  embedded: (filename: string) => `Chan eil dealbh aig ${filename} a chaidh a leasachadh o dhàta a' mhothaicheir, agus cha chleachdar ro-shealladh a' chamara a-riamh ann an co-chruinneachadh.`,
  done: `Chaidh an co-chruinneachadh às-phortadh. Cha deach na dealbhan tùsail agad atharrachadh.`,
  doneSoft: (n: number) => plural(n, { one: `Chaidh an co-chruinneachadh às-phortadh. Chaidh ${n} uinneag a mheudachadh no tha i fo dhùmhlachd a' chlò-bhualaidh, mar a chaidh a shealltainn ron às-phortadh. Cha deach na dealbhan tùsail agad atharrachadh.`, other: `Chaidh an co-chruinneachadh às-phortadh. Chaidh ${n} uinneagan a mheudachadh no tha iad fo dhùmhlachd a' chlò-bhualaidh, mar a chaidh a shealltainn ron às-phortadh. Cha deach na dealbhan tùsail agad atharrachadh.` }),
};
