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
    stop: "Ná seol níos mó cuirí chuig an seoladh seo",
    someone: "Duine éigin",
  },
  unsubscribe: {
    title: "Gan níos mó cuirí",
    confirm: "Brúigh an cnaipe chun stop a chur le cuirí chuig an seoladh seo.",
    button: "Gan níos mó cuirí",
    done: "Déanta. Ní sheolfaidh InFlight cuirí chuig an seoladh seo arís.",
    invalid: "Níl an nasc seo bailí.",
    invalidHint: "Freagair an ríomhphost agus stopfaimid iad.",
  },
};
