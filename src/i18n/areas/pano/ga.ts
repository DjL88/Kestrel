import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fuaigh ${n} grianghraf ina lánléargas`,
  menuHint: "Fuaigheann sé grianghraif a fhorluíonn le chéile i ngrianghraf leathan nua amháin, bearrtha go picteilíní fíora. Ní athraítear na bunghrianghraif.",
  task: (n: number) => `Lánléargas á fhuáil ó ${n} grianghraf`,
  reading: "Na grianghraif á léamh",
  matching: "Ag lorg cá bhforluíonn na grianghraif",
  placing: "Na grianghraif á suíomh",
  blending: "Na huamanna á meascadh",
  saving: "An lánléargas á chur leis",
  done: (name: string, n: number) => `Cuireadh ${name} leis, fuaite ó ${n} grianghraf. Níor athraíodh do ghrianghraif bhunaidh.`,
  cropNote: (percent: number) => `Bearrtha go dtí an ${percent}% den limistéar atá faoi phicteilíní fíora. Níor líonadh aon rud.`,
  cancelled: "Stopadh an fhuáil. Níor cuireadh aon rud leis. Níor athraíodh do ghrianghraif bhunaidh.",
  failed: "Níor críochnaíodh an lánléargas. Oscail Tascanna chun an chúis a fheiceáil. Níor athraíodh do ghrianghraif bhunaidh.",
  tooFew: "Roghnaigh dhá ghrianghraf ar a laghad a fhorluíonn. Níor athraíodh do ghrianghraif bhunaidh.",
  tooMany: (max: number) => `Roghnaigh suas le ${max} grianghraf ag an am céanna. Níor athraíodh do ghrianghraif bhunaidh.`,
  sizeMismatch: "Tá na grianghraif seo de mhéideanna difriúla, mar sin níor fuaitheadh iad. Níor athraíodh do ghrianghraif bhunaidh.",
  tooFlat: (n: number) => `Níl dóthain mionsonraí i ngrianghraf ${n} chun é a ailíniú, mar sin níor fuaitheadh aon rud seachas buille faoi thuairim. Níor athraíodh do ghrianghraif bhunaidh.`,
  unrelated: (n: number) => `Ní fhorluíonn grianghraf ${n} an ceann roimhe go leor chun iad a ailíniú, mar sin níor fuaitheadh aon rud. Roghnaigh na grianghraif san ord inar thóg tú iad, gach ceann thar thrian den chéad cheann eile. Níor athraíodh do ghrianghraif bhunaidh.`,
  ambiguous: (n: number) => `Níl sé soiléir cá dtagann grianghraf ${n} leis an gceann roimhe. Athdhéantar an patrún, nó chlaon an ceamara an iomarca, mar sin níor fuaitheadh aon rud seachas buille faoi thuairim. Níor athraíodh do ghrianghraif bhunaidh.`,
  vertical: "Téann na grianghraif seo suas agus síos seachas taobh le taobh. Ní thacaítear le lánléargais ingearacha fós, mar sin níor fuaitheadh aon rud. Níor athraíodh do ghrianghraif bhunaidh.",
  tooLarge: "Bheadh an lánléargas seo rómhór le déanamh go sábháilte ar an ngléas seo, agus ní dhéantar níos lú é gan fiafraí. Roghnaigh níos lú grianghraf. Níor athraíodh do ghrianghraif bhunaidh.",
  noCoverage: "Ní fhágann na grianghraif dronuilleog faoi phicteilíní fíora, mar sin níor fuaitheadh aon rud seachas bearnaí a líonadh. Níor athraíodh do ghrianghraif bhunaidh.",
  unsupported: (name: string) => `Ní féidir ${name} a léamh ag lánmhéid anseo, mar sin níor fuaitheadh aon rud. Níor úsáideadh pictiúr níos lú ina áit. Níor athraíodh do ghrianghraif bhunaidh.`,
  rawNotDeveloped: (name: string) => `Níl forbairt lánmhéide ó shonraí an bhraiteora ag ${name} fós, agus ní úsáidtear an réamhamharc beag atá leabaithe sa cheamara do lánléargais. Déan an fhorbairt lánmhéide ar dtús. Níor athraíodh do ghrianghraif bhunaidh.`,
  exposureDiffers: "Tógadh na grianghraif le gile measartha difriúil. Cothromaíodh iad, ach seiceáil an spéir le haghaidh bandaí.",
  seamsVisible: "D'fhéadfadh roinnt uamanna a bheith le feiceáil: bhog rud éigin idir grianghraif, nó bhog an ceamara seachas casadh.",
  focalEstimated: "Níor taifeadadh fad fócasach an lionsa, mar sin oibríodh amach é ó na grianghraif.",
  mainThread: "Ritheadh é sa tulra mar nach bhfuil obair chúlra ar fáil anseo, mar sin b'fhéidir gur stad an aip uaireanta.",
  infoTitle: "Lánléargas",
  infoMadeFrom: (n: number) => plural(n, { one: `Fuaite ó ${n} grianghraf:`, other: `Fuaite ó ${n} grianghraf:` }),
  infoHow: "Curtha ar shorcóir, uamanna meáite go réidh agus bearrtha go picteilíní fíora. Níor gineadh aon phicteilín.",
};
