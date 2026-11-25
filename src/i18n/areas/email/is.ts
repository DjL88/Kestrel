import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} bauð þér í „${project}“ á InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} bauð þér í InFlight-verkefnið „${project}“ ${as}.`,
    as: { editor: "sem ritstjóra", commenter: "sem álitsgjafa", viewer: "sem áhorfanda", client: "sem viðskiptavini" },
    join: "Opnaðu InFlight og skráðu þig inn með þessu netfangi til að taka þátt.",
    open: "Opna InFlight",
    ignore: "Áttir þú ekki von á þessu? Þá geturðu hunsað það. Ekkert gerist nema þú samþykkir.",
    stop: "Ekki senda fleiri boð á þetta netfang",
    someone: "Einhver",
  },
  unsubscribe: {
    title: "Engin fleiri boð",
    confirm: "Ýttu á hnappinn til að fá ekki fleiri boð á þetta netfang.",
    button: "Engin fleiri boð",
    done: "Búið. InFlight sendir ekki fleiri boð á þetta netfang.",
    invalid: "Þessi tengill er ekki gildur.",
    invalidHint: "Svaraðu tölvupóstinum og við hættum.",
  },
};
