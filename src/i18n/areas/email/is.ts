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
    stop: "Ekki senda fleiri tölvupósta frá InFlight á þetta netfang",
    someone: "Einhver",
  },
  unsubscribe: {
    title: "Engir fleiri tölvupóstar frá InFlight",
    confirm: "Ýttu á hnappinn til að fá enga fleiri tölvupósta frá InFlight á þetta netfang.",
    button: "Engir fleiri tölvupóstar",
    done: "Búið. InFlight sendir ekki fleiri tölvupósta á þetta netfang.",
    invalid: "Þessi tengill er ekki gildur.",
    invalidHint: "Svaraðu tölvupóstinum og við hættum.",
    stopNews: "Hætta að fá fréttir frá InFlight í tölvupósti",
    stopNotices: "Hætta að fá tölvupóst um sameiginleg verkefni þín",
    confirmNews: "Ýttu á hnappinn til að hætta að fá fréttir frá InFlight í tölvupósti. Póstur um aðganginn, til dæmis leyfislykill, berst áfram.",
    confirmNotices: "Ýttu á hnappinn til að hætta að fá tölvupóst um sameiginleg verkefni þín. Þú sérð þau áfram í forritinu.",
    doneNews: "Búið. Kveiktu aftur á fréttum í tölvupósti í Stillingar → Aðgangur í InFlight.",
    doneNotices: "Búið. Kveiktu aftur á þessum pósti í Stillingar → Aðgangur í InFlight.",
  },
  news: {
    why: "Þú færð þetta af því að þú baðst um fréttir frá InFlight í tölvupósti. Til að hætta skaltu slökkva á því í Stillingar → Aðgangur eða nota tengilinn hér fyrir neðan.",
  },
};
