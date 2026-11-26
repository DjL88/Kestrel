import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  menu: (n: number) => `Cruach fócais de ${n} grianghraf`,
  menuHint: "Cumascann sé na codanna is géire de gach grianghraf i ngrianghraf nua. Ní athraítear na bunghrianghraif.",
  task: (n: number) => `Ag cruachadh fócais ${n} grianghraf`,
  reading: "Ag léamh na ngrianghraf",
  aligning: "Ag ailíniú na ngrianghraf",
  blending: "Ag cumasc na gcodanna is géire",
  saving: "Ag cur an ghrianghraif chruachta leis",
  done: (name: string, n: number) => `Cuireadh ${name} leis, cruachta ó ${n} grianghraf. Níor athraíodh do ghrianghraif bhunaidh.`,
  cancelled: "Stopadh an cruachadh fócais. Níor cuireadh aon rud leis. Níor athraíodh do ghrianghraif bhunaidh.",
  failed: "Níor críochnaíodh an cruachadh fócais. Oscail Tascanna chun an chúis a fheiceáil. Níor athraíodh do ghrianghraif bhunaidh.",
  tooFew: "Roghnaigh dhá ghrianghraf ar a laghad den radharc céanna. Níor athraíodh do ghrianghraif bhunaidh.",
  tooMany: (max: number) => `Roghnaigh suas le ${max} grianghraf ag an am céanna. Níor athraíodh do ghrianghraif bhunaidh.`,
  sizeMismatch: "Tá na grianghraif seo de mhéideanna éagsúla, mar sin ní féidir iad a ailíniú. Níor athraíodh do ghrianghraif bhunaidh.",
  unrelated: (n: number) => `Ní cosúil gurb é grianghraf ${n} an radharc céanna lena chomharsa, mar sin níor cruachadh aon rud. Roghnaigh frámaí ó aon phléasc amháin. Níor athraíodh do ghrianghraif bhunaidh.`,
  ambiguous: (n: number) => `Níl sé soiléir conas a ailíníonn grianghraf ${n} lena chomharsa (athdhéanann an patrún, nó bhog sé an iomarca), mar sin níor cruachadh aon rud seachas buille faoi thuairim. Níor athraíodh do ghrianghraif bhunaidh.`,
  tooFlat: (n: number) => `Tá ró-bheagán mionsonraí i ngrianghraf ${n} chun é a ailíniú, mar sin níor cruachadh aon rud seachas buille faoi thuairim. Níor athraíodh do ghrianghraif bhunaidh.`,
  unsupported: (name: string) => `Ní féidir ${name} a léamh ag lánmhéid anseo, mar sin níor cruachadh aon rud. Níor úsáideadh pictiúr níos lú ina áit. Níor athraíodh do ghrianghraif bhunaidh.`,
  rawNotDeveloped: (name: string) => `Níl forbairt lánmhéide ó shonraí an bhraiteora ag ${name} fós, agus ní úsáidtear an réamhamharc beag atá leabaithe sa cheamara. Déan an fhorbairt lánmhéide ar dtús. Níor athraíodh do ghrianghraif bhunaidh.`,
  tooLarge: "Tá na grianghraif seo rómhór le cruachadh go sábháilte ar an ngléas seo. Níor cruachadh aon rud. Níor athraíodh do ghrianghraif bhunaidh.",
  equallySharp: "Is cosúil go bhfuil na grianghraif seo chomh géar céanna i ngach áit, mar sin d'fhéadfadh an chruach a bheith an-chosúil leis na bunghrianghraif.",
  frameUnused: (n: number) => `Is beag nár chuir grianghraf ${n} aon rud leis.`,
  oneFrameDominates: "Thug grianghraf amháin beagnach na mionsonraí go léir. Seiceáil gur glacadh na grianghraif ag faid fhócais éagsúla.",
  localFallback: (n: number) => `Níor ailíníodh grianghraf ${n} ach ina iomláine: bhí ró-bheagán mionsonraí comhoiriúnacha ann d'ailíniú níos míne.`,
  mainThread: "Ritheadh é sa tulra mar nach bhfuil obair chúlra ar fáil anseo, mar sin b'fhéidir gur stad an aip uaireanta.",
  infoTitle: "Cruach fócais",
  infoMadeFrom: (n: number) => plural(n, { one: `Déanta ó ${n} grianghraf:`, other: `Déanta ó ${n} grianghraf:` }),
  infoHow: "Tagann gach cuid ón ngrianghraf is géire san áit sin, cumaiscthe go réidh. Níor gineadh aon phicteilín.",
};
