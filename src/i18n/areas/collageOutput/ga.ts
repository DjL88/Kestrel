import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  size: `Méid easpórtála`,
  standard: (w: number, h: number) => `Caighdeánach · ${w} × ${h} px`,
  double: (w: number, h: number) => `Faoi dhó an mhéid · ${w} × ${h} px`,
  custom: `Taobh fada saincheaptha`,
  customEdge: `An taobh fada i bpicteilíní`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Taifeach priontála`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `PDF RGB do shaotharlann grianghraf, ${dpi} PPI, fuiliú 3 mm agus boscaí bearrtha. Ní CMYK ná PDF/X deimhnithe é.`,
  windows: `Grianghraif i ngach fuinneog`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Leathanach ${page}, cúlra: ${filename}` : `Leathanach ${page}, fuinneog ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px sa ghrianghraf, taispeánta ag ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Taispeánta ag ${ww} × ${wh} px. Seiceáiltear méid an ghrianghraif nuair a easpórtáiltear an colláis.`,
  enlarged: (percent: number) => `Méadaithe go ${percent}%, mar sin beidh cuma níos boige air.`,
  sharp: `Dóthain picteilíní don mhéid seo.`,
  ppi: (ppi: number) => `${ppi} picteilín san orlach.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} picteilín san orlach, faoi bhun na ${dpi} DPI a roghnaíodh, mar sin beidh an phriontáil níos boige.`,
  lowSummary: (n: number) => plural(n, { one: `Tá níos lú picteilíní ag ${n} fhuinneog ná mar a theastaíonn don mhéid seo. Roghnaigh méid níos lú, nó easpórtáil mar sin féin agus beidh cuma níos boige uirthi.`, other: `Tá níos lú picteilíní ag ${n} fhuinneog ná mar a theastaíonn don mhéid seo. Roghnaigh méid níos lú, nó easpórtáil mar sin féin agus beidh cuma níos boige orthu.` }),
  exportAnyway: (n: number) => plural(n, { one: `Easpórtáil mar sin féin (${n} fhuinneog níos boige)`, other: `Easpórtáil mar sin féin (${n} fhuinneog níos boige)` }),
  rawNote: `Forbraíonn InFlight grianghraif RAW ó shonraí an bhraiteora, mar a dhéantar san eagarthóir; ní úsáidtear réamhamhairc leabaithe an cheamara riamh. Ní thacaítear le bunchomhaid HEIF i gcolláis fós.`,
  heif: (filename: string) => `Is comhad HEIF é ${filename}. Ní féidir le colláis a picteilíní lánthaifigh a fhíorú fós, mar sin níor cuireadh aon rud ina áit.`,
  embedded: (filename: string) => `Níl aon íomhá ag ${filename} a forbraíodh ó shonraí an bhraiteora, agus ní úsáidtear réamhamharc leabaithe an cheamara riamh i gcolláis.`,
  done: `Easpórtáladh an colláis. Níor athraíodh do bhunchomhaid.`,
  doneSoft: (n: number) => plural(n, { one: `Easpórtáladh an colláis. Méadaíodh ${n} fhuinneog nó tá sí faoi bhun an taifigh priontála, mar a taispeánadh roimh an easpórtáil. Níor athraíodh do bhunchomhaid.`, other: `Easpórtáladh an colláis. Méadaíodh ${n} fhuinneog nó tá siad faoi bhun an taifigh priontála, mar a taispeánadh roimh an easpórtáil. Níor athraíodh do bhunchomhaid.` }),
};
