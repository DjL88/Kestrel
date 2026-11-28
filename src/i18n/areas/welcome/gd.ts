import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  welcome: {
    title: "Fàilte gu InFlight",
    intro: "Trì rudan as fhiach fios a bhith agad orra mus tòisich thu:",
    originals: "Fanaidh na dealbhan tùsail agad far a bheil iad. Cha bhi InFlight a-chaoidh gan atharrachadh, gan gluasad no gan cur an àite.",
    undo: "Gabhaidh gach deasachadh a neo-dhèanamh. Glèidhidh InFlight reasabaidh de na h-atharraichean agad, chan e lethbhreac ùr den dealbh.",
    backup: "Glèidhidh lethbhreac-glèidhidh pròiseict na co-dhùnaidhean, na rangachaidhean agus na deasachaidhean agad, ach chan e na faidhlichean RAW fhèin. Dèan lethbhreac-glèidhidh de na dealbhan tùsail cuideachd.",
    done: "Tha mi a' tuigsinn",
  },
  browserStorage: {
    title: "Stòras a' bhrabhsair seo",
    checking: "A' sgrùdadh dè chumas am brabhsair seo…",
    standard: "Faodaidh am brabhsair seo stòras InFlight fhalamhachadh nuair a bhios àite gann no nuair a thèid dàta na làraich fhalamhachadh.",
    requesting: "Ag iarraidh air a' bhrabhsair stòras InFlight a chumail…",
    persistent: "Dh'aontaich am brabhsair seo stòras InFlight a chumail. Ma dh'fhalamhaicheas tu fhèin dàta na làraich, thèid a thoirt air falbh co-dhiù.",
    declined: "Cha do dh'aontaich am brabhsair stòras InFlight a chumail. Bidh e fhèin a' co-dhùnadh seo, gu tric a rèir na tha thu a' cleachdadh na làraich. Faodaidh tu iarraidh a-rithist an ceann greis.",
    unavailable: "Chan urrainn dhan bhrabhsair seo gealltainn gun cùm e stòras InFlight.",
    ask: "Iarr air a' bhrabhsair an stòras a chumail",
    kept: "Thathar a' cumail an stòrais",
    permissionsTitle: "Ceadan fhaidhlichean",
    permissions: "Cha leig am brabhsair le InFlight ach na dealbhan is na pasgain a thaghas tu a leughadh. Às dèidh dhut an taba a dhùnadh no ath-thòiseachadh, dh'fhaoidte gun iarr e cead a-rithist mus fhaic InFlight pasgan. Cha dèan diùltadh cron air na dealbhan agad; chan urrainn do InFlight an sealltainn gus an toir thu cead.",
    forgetTitle: "Na dh'fhaodas am brabhsair a dhìochuimhneachadh",
    forget: "Tha na pròiseactan, na co-dhùnaidhean, na deasachaidhean is na ro-sheallaidhean agad sa bhrabhsair seo. Faodaidh falamhachadh dàta brabhsaidh, uinneag phrìobhaideach no dì-stàladh a' bhrabhsair an toirt air falbh. Cha tèid na dealbhan tùsail agad a stòradh no atharrachadh an seo idir, mar sin tha iad sàbhailte.",
    backupHint: "Airson a bhith sàbhailte, dèan lethbhreac-glèidhidh bho roghainnean a' phròiseict is cùm e, còmhla ris na dealbhan tùsail, àiteigin taobh a-muigh a' bhrabhsair seo.",
  },
  diskPreviews: {
    title: "Ro-sheallaidhean air a’ choimpiutair seo",
    intro: "Cumaidh InFlight trì dealbhan beaga de gach dealbh RAW na phasgan fhèin: dealbhag, lethbhreac airson sùil a thoirt air agus ro-shealladh glic 2,560 px. Faodaidh tu cumail a’ deasachadh dealbh nuair nach eil an draibh aige ceangailte. Feumaidh às-phortadh an tionndadh tùsail fhathast. Chan atharraichear na dealbhan tùsail agad idir.",
    using: "A’ cleachdadh {used} airson {count} dealbhan.",
    checking: "A’ sgrùdadh pasgan nan ro-sheallaidhean…",
    limitLabel: "Crìoch meud",
    limitDefault: "{size} (molta airson a’ choimpiutair seo)",
    limitHint: "Bidh àite airson mu {count} dealbhan. Nuair a bhios am pasgan làn, thèid na ro-sheallaidhean air nach do choimhead thu as fhaide a thoirt air falbh. Thèid an dèanamh a-rithist nuair a dh’fhosglas tu na dealbhan sin leis an draibh ceangailte.",
    clear: "Thoir air falbh gach ro-shealladh",
    cleared: "Chaidh na ro-sheallaidhean a thoirt air falbh. Thèid an dèanamh a-rithist nuair a choimheadas tu air dealbhan.",
    failed: "Cha b’ urrainn dhuinn pasgan nan ro-sheallaidhean a leughadh.",
  },
};
