import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} wedi eich gwahodd i “${project}” ar InFlight`,
    invited: (inviter: string, project: string, as: string) => `Mae ${inviter} wedi eich gwahodd i brosiect InFlight “${project}” ${as}.`,
    as: { editor: "fel golygydd", commenter: "fel sylwebydd", viewer: "fel gwyliwr", client: "fel cleient" },
    join: "I ymuno, agorwch InFlight a mewngofnodwch gyda’r cyfeiriad e-bost hwn.",
    open: "Agor InFlight",
    ignore: "Heb ddisgwyl hwn? Gallwch ei anwybyddu. Does dim yn digwydd oni bai eich bod yn derbyn.",
    stop: "Stopio e-byst gan InFlight i’r cyfeiriad hwn",
    someone: "Rhywun",
  },
  unsubscribe: {
    title: "Stopio e-byst gan InFlight",
    confirm: "Pwyswch y botwm i stopio pob e-bost gan InFlight i’r cyfeiriad hwn.",
    button: "Stopio e-byst",
    done: "Wedi’i wneud. Ni fydd InFlight yn anfon e-bost i’r cyfeiriad hwn eto.",
    invalid: "Nid yw’r ddolen hon yn ddilys.",
    invalidHint: "Atebwch yr e-bost a byddwn yn eu stopio.",
    stopNews: "Stopio newyddion InFlight drwy e-bost",
    stopNotices: "Stopio e-byst am eich prosiectau a rennir",
    confirmNews: "Pwyswch y botwm i stopio newyddion InFlight drwy e-bost. Bydd e-byst am eich cyfrif, fel allwedd drwydded, yn dal i gyrraedd.",
    confirmNotices: "Pwyswch y botwm i stopio e-byst am eich prosiectau a rennir. Byddwch yn dal i'w gweld yn yr ap.",
    doneNews: "Wedi'i wneud. I droi newyddion drwy e-bost yn ôl ymlaen, agorwch Gosodiadau → Cyfrif yn InFlight.",
    doneNotices: "Wedi'i wneud. I droi'r e-byst hyn yn ôl ymlaen, agorwch Gosodiadau → Cyfrif yn InFlight.",
  },
  news: {
    why: "Rydych chi’n cael hwn oherwydd i chi ofyn am newyddion InFlight drwy e-bost. I stopio, diffoddwch hyn yn Gosodiadau → Cyfrif, neu defnyddiwch y ddolen isod.",
  },
};
