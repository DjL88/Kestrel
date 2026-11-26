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
    webNote: "Ann am brabhsair-lìn, iarraidh InFlight air a' bhrabhsair an stòras aige a chumail nuair a leanas tu air adhart. Chì thu dè tha sin a' ciallachadh anns na Roghainnean, fo Stòras.",
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
};
