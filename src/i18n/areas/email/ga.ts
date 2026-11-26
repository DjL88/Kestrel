import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `Thug ${inviter} cuireadh duit chuig “${project}” ar InFlight`,
    invited: (inviter: string, project: string, as: string) => `Thug ${inviter} cuireadh duit chuig an tionscadal InFlight “${project}” ${as}.`,
    as: { editor: "mar eagarthóir", commenter: "mar thráchtaire", viewer: "mar bhreathnóir", client: "mar chliant" },
    join: "Chun páirt a ghlacadh, oscail InFlight agus sínigh isteach leis an seoladh ríomhphoist seo.",
    open: "Oscail InFlight",
    ignore: "Nach raibh tú ag súil leis seo? Is féidir leat neamhaird a dhéanamh air. Ní tharlaíonn aon rud mura nglacann tú leis.",
    stop: "Ná seol ríomhphoist ó InFlight chuig an seoladh seo",
    someone: "Duine éigin",
  },
  unsubscribe: {
    title: "Gan ríomhphoist ó InFlight",
    confirm: "Brúigh an cnaipe chun stop a chur le gach ríomhphost ó InFlight chuig an seoladh seo.",
    button: "Stop ríomhphoist",
    done: "Déanta. Ní sheolfaidh InFlight ríomhphost chuig an seoladh seo arís.",
    invalid: "Níl an nasc seo bailí.",
    invalidHint: "Freagair an ríomhphost agus stopfaimid iad.",
    stopNews: "Stop nuacht InFlight trí ríomhphost",
    stopNotices: "Stop ríomhphoist faoi do thionscadail roinnte",
    confirmNews: "Brúigh an cnaipe chun nuacht InFlight trí ríomhphost a stopadh. Tiocfaidh ríomhphoist faoi do chuntas, mar eochair cheadúnais, fós.",
    confirmNotices: "Brúigh an cnaipe chun ríomhphoist faoi do thionscadail roinnte a stopadh. Feicfidh tú fós iad san aip.",
    doneNews: "Déanta. Chun nuacht trí ríomhphost a chur ar siúl arís, oscail Socruithe → Cuntas in InFlight.",
    doneNotices: "Déanta. Chun na ríomhphoist seo a chur ar siúl arís, oscail Socruithe → Cuntas in InFlight.",
  },
  news: {
    why: "Tá sé seo á fháil agat mar gur iarr tú nuacht InFlight trí ríomhphost. Chun é a stopadh, múch é in Socruithe → Cuntas, nó úsáid an nasc thíos.",
  },
};
