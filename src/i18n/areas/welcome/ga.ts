import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  welcome: {
    title: "Fáilte go InFlight",
    intro: "Trí rud is fiú a bheith ar eolas agat sula dtosaíonn tú:",
    originals: "Fanann do ghrianghraif bhunaidh san áit a bhfuil siad. Ní athraíonn, ní bhogann agus ní ionadaíonn InFlight iad riamh.",
    undo: "Is féidir gach eagarthóireacht a chealú. Coinníonn InFlight oideas de na hathruithe a rinne tú, ní cóip nua den ghrianghraf.",
    backup: "Coinníonn cúltaca tionscadail do chinntí, do rátálacha agus d'eagarthóireacht, ach ní na comhaid RAW féin. Déan cúltaca de do bhunghrianghraif freisin.",
    webNote: "I mbrabhsálaí gréasáin, iarrfaidh InFlight ar an mbrabhsálaí a stóras a choinneáil nuair a leanann tú ar aghaidh. Feicfidh tú cad is brí leis sin sna Socruithe, faoi Stóras.",
    done: "Tuigim",
  },
  browserStorage: {
    title: "Stóras an bhrabhsálaí seo",
    checking: "Ag seiceáil cad a choinníonn an brabhsálaí seo…",
    standard: "Féadfaidh an brabhsálaí seo stóras InFlight a ghlanadh nuair a bhíonn spás gann nó nuair a ghlantar sonraí an tsuímh.",
    requesting: "Ag iarraidh ar an mbrabhsálaí stóras InFlight a choinneáil…",
    persistent: "D'aontaigh an brabhsálaí seo stóras InFlight a choinneáil. Má ghlanann tú féin sonraí an tsuímh, bainfear é mar sin féin.",
    declined: "Níor aontaigh an brabhsálaí stóras InFlight a choinneáil. Is é féin a chinneann é seo, go minic de réir an méid a úsáideann tú an suíomh. Is féidir leat iarraidh arís níos déanaí.",
    unavailable: "Ní féidir leis an mbrabhsálaí seo gealladh go gcoinneoidh sé stóras InFlight.",
    ask: "Iarr ar an mbrabhsálaí an stóras a choinneáil",
    kept: "Tá an stóras á choinneáil",
    permissionsTitle: "Ceadanna comhad",
    permissions: "Ní ligeann an brabhsálaí do InFlight ach na grianghraif agus na fillteáin a roghnaíonn tú a léamh. Tar éis duit an cluaisín a dhúnadh nó atosú, d'fhéadfadh sé cead a iarraidh arís sula bhfeiceann InFlight fillteán. Ní dhéanann diúltú dochar do do ghrianghraif; ní féidir le InFlight iad a thaispeáint go dtí go dtugann tú cead.",
    forgetTitle: "Cad is féidir leis an mbrabhsálaí a dhearmad",
    forget: "Coinnítear do thionscadail, do chinntí, d'eagarthóireacht agus do réamhamhairc sa bhrabhsálaí seo. Is féidir iad a bhaint trí shonraí brabhsála a ghlanadh, fuinneog phríobháideach a úsáid nó an brabhsálaí a dhíshuiteáil. Ní stóráiltear ná ní athraítear do bhunghrianghraif anseo riamh, mar sin tá siad slán.",
    backupHint: "Le bheith slán, déan cúltaca ó roghanna an tionscadail agus coinnigh é, in éineacht le do bhunghrianghraif, áit éigin lasmuigh den bhrabhsálaí seo.",
  },
  diskPreviews: {
    title: "Réamhamhairc ar an ríomhaire seo",
    intro: "Coinníonn InFlight trí phictiúr bheaga de gach grianghraf RAW ina fhillteán féin: mionsamhail, cóip athbhreithnithe agus réamhamharc cliste 2,560 px. Is féidir leat leanúint ar aghaidh ag cur grianghraf in eagar nuair nach bhfuil a thiomántán ceangailte. Tá an bunleagan fós ag teastáil le heaspórtáil. Ní athraítear do bhunleaganacha riamh.",
    using: "{used} in úsáid do {count} grianghraf.",
    checking: "Ag seiceáil fhillteán na réamhamharc…",
    limitLabel: "Teorainn mhéide",
    limitDefault: "{size} (molta don ríomhaire seo)",
    limitHint: "Tá spás do thart ar {count} grianghraf. Nuair a bhíonn an fillteán lán, baintear na réamhamhairc nár fhéach tú orthu le fada. Déantar arís iad nuair a osclaíonn tú na grianghraif sin agus a dtiomántán ceangailte.",
    clear: "Bain gach réamhamharc",
    cleared: "Baineadh na réamhamhairc. Déantar arís iad agus tú ag féachaint ar ghrianghraif.",
    failed: "Níorbh fhéidir fillteán na réamhamharc a léamh.",
  },
};
