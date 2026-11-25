import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `Thug ${inviter} cuireadh dhut gu “${project}” air InFlight`,
    invited: (inviter: string, project: string, as: string) => `Thug ${inviter} cuireadh dhut gu pròiseact InFlight “${project}” ${as}.`,
    as: { editor: "mar neach-deasachaidh", commenter: "mar neach-beachdachaidh", viewer: "mar neach-coimhead", client: "mar neach-dèiligidh" },
    join: "Airson pàirt a ghabhail, fosgail InFlight agus clàraich a-steach leis an t-seòladh puist-d seo.",
    open: "Fosgail InFlight",
    ignore: "Cha robh dùil agad ri seo? Faodaidh tu a leigeil seachad. Cha tachair dad mura gabh thu ris.",
    stop: "Na cuir tuilleadh puist-d bho InFlight dhan t-seòladh seo",
    someone: "Cuideigin",
  },
  unsubscribe: {
    title: "Gun tuilleadh puist-d bho InFlight",
    confirm: "Brùth am putan gus stad a chur air gach post-d bho InFlight dhan t-seòladh seo.",
    button: "Cuir stad air puist-d",
    done: "Deiseil. Cha chuir InFlight post-d dhan t-seòladh seo tuilleadh.",
    invalid: "Chan eil an ceangal seo dligheach.",
    invalidHint: "Freagair am post-d agus cuiridh sinn stad orra.",
  },
};
