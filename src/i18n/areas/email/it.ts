import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian. DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} ti ha invitato a «${project}» su InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} ti ha invitato al progetto InFlight «${project}» ${as}.`,
    as: { editor: "come redattore", commenter: "come commentatore", viewer: "come osservatore", client: "come cliente" },
    join: "Per partecipare, apri InFlight e accedi con questo indirizzo email.",
    open: "Apri InFlight",
    ignore: "Non te lo aspettavi? Puoi ignorarlo. Non succede nulla se non accetti.",
    stop: "Non ricevere più email da InFlight a questo indirizzo",
    someone: "Qualcuno",
  },
  unsubscribe: {
    title: "Non ricevere più email da InFlight",
    confirm: "Premi il pulsante per non ricevere più email da InFlight a questo indirizzo.",
    button: "Non ricevere più email",
    done: "Fatto. InFlight non invierà più email a questo indirizzo.",
    invalid: "Questo link non è valido.",
    invalidHint: "Rispondi all’email e li fermeremo.",
    stopNews: "Non ricevere più novità di InFlight via email",
    stopNotices: "Non ricevere più email sui tuoi progetti condivisi",
    confirmNews: "Premi il pulsante per non ricevere più le novità di InFlight via email. Le email sul tuo account, come una chiave di licenza, arrivano comunque.",
    confirmNotices: "Premi il pulsante per non ricevere più email sui tuoi progetti condivisi. Li vedi ancora nell’app.",
    doneNews: "Fatto. Per riattivare le novità via email, apri Impostazioni → Account in InFlight.",
    doneNotices: "Fatto. Per riattivare queste email, apri Impostazioni → Account in InFlight.",
  },
  news: {
    why: "Ricevi questo messaggio perché hai chiesto le novità di InFlight via e-mail. Per smettere, disattivale in Impostazioni → Account oppure usa il link qui sotto.",
  },
};
