import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  menu: (n: number) => `Cumaisc ${n} grianghraf go HDR`,
  menuHint: "Cumascann sé sraith grianghraf níos dorcha agus níos gile i ngrianghraf nua 16 giotán a choinníonn na buaicphointí agus na scáthanna. Ní athraítear na bunghrianghraif.",
  task: (n: number) => `Ag cumasc ${n} grianghraf go HDR`,
  reading: "Ag léamh na ngrianghraf",
  aligning: "Ag ailíniú na ngrianghraf",
  merging: "Ag cumasc na nochtaí",
  saving: "Ag cur an ghrianghraif HDR leis",
  done: (name: string, n: number) => `Cuireadh ${name} leis, cumaiscthe ó ${n} grianghraf. Níor athraíodh do ghrianghraif bhunaidh.`,
  cancelled: "Stopadh an cumasc HDR. Níor cuireadh aon rud leis. Níor athraíodh do ghrianghraif bhunaidh.",
  failed: "Níor críochnaíodh an cumasc HDR. Oscail Tascanna chun an chúis a fheiceáil. Níor athraíodh do ghrianghraif bhunaidh.",
  tooFew: "Roghnaigh dhá ghrianghraf ar a laghad den radharc céanna, tógtha níos dorcha agus níos gile, le cumasc go HDR. Níor athraíodh do ghrianghraif bhunaidh.",
  tooMany: (max: number) => `Roghnaigh suas le ${max} grianghraf ag an am céanna le cumasc go HDR. Níor athraíodh do ghrianghraif bhunaidh.`,
  sizeMismatch: "Tá na grianghraif seo de mhéideanna éagsúla, mar sin ní féidir iad a ailíniú. Níor athraíodh do ghrianghraif bhunaidh.",
  sameExposure: "Is cosúil go bhfuil an nochtadh céanna ag na grianghraif seo, mar sin níl aon rud le cumasc. Roghnaigh sraith a tógadh níos dorcha agus níos gile. Níor athraíodh do ghrianghraif bhunaidh.",
  unrelated: (n: number) => `Ní ailíníonn grianghraf ${n} soiléir go leor leis na cinn eile, mar sin níor cumascadh aon rud seachas buille faoi thuairim a thabhairt. Roghnaigh grianghraif ó shraith amháin. Níor athraíodh do ghrianghraif bhunaidh.`,
  unsupported: (name: string) => `Ní féidir ${name} a léamh ag lánmhéid anseo, mar sin níor cumascadh aon rud. Níor úsáideadh pictiúr níos lú ina áit. Níor athraíodh do ghrianghraif bhunaidh.`,
  rawNotDeveloped: (name: string) => `Níorbh fhéidir ${name} a fhorbairt ag 16 giotán ó shonraí an bhraiteora anseo, agus ní úsáidtear réamhamharc beag leabaithe an cheamara le haghaidh HDR. Athcheangail an bunleagan agus bain triail eile as. Níor athraíodh do ghrianghraif bhunaidh.`,
  tooLarge: "Tá na grianghraif seo rómhór le cumasc go sábháilte ar an ngléas seo. Níor cumascadh aon rud. Níor athraíodh do ghrianghraif bhunaidh.",
  ghostsRemoved: "Bhog rud éigin idir na grianghraif. Ansin, ní úsáideann an cumasc ach grianghraf amháin, ionas nach bhfeictear aon rud faoi dhó.",
  highlightsClipped: "Bhí roinnt buaicphointí rógheal fiú sa ghrianghraf is dorcha, mar sin fanann siad bán.",
  mainThread: "Ritheadh é sa tulra mar nach bhfuil obair chúlra ar fáil anseo, mar sin b'fhéidir gur stad an aip uaireanta.",
  infoTitle: "Cumasc HDR",
  infoMadeFrom: (n: number) => plural(n, { one: `Déanta ó ${n} grianghraf:`, other: `Déanta ó ${n} grianghraf:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stad`,
  infoHow: "Tagann gach cuid ó na grianghraif a bhí nochta go maith ansin, ailínithe agus ualaithe de réir nochta, agus ansin coigeartaithe le Buaicphointí agus Scáthanna an eagarthóra. Níor gineadh aon phicteilín.",
};
