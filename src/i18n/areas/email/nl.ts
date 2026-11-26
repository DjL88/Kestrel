import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch. DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} heeft u uitgenodigd voor ‘${project}’ op InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} heeft u uitgenodigd voor het InFlight-project ‘${project}’ ${as}.`,
    as: { editor: "als bewerker", commenter: "als commentator", viewer: "als kijker", client: "als klant" },
    join: "Open InFlight en meld u aan met dit e-mailadres om mee te doen.",
    open: "InFlight openen",
    ignore: "Niet verwacht? Dan kunt u dit negeren. Er gebeurt niets als u niet accepteert.",
    stop: "Geen e-mails meer van InFlight naar dit adres",
    someone: "Iemand",
  },
  unsubscribe: {
    title: "Geen e-mails meer van InFlight",
    confirm: "Druk op de knop om geen e-mails van InFlight meer naar dit adres te krijgen.",
    button: "Geen e-mails meer",
    done: "Klaar. InFlight stuurt geen e-mails meer naar dit adres.",
    invalid: "Deze link is niet geldig.",
    invalidHint: "Beantwoord de e-mail, dan stoppen we ermee.",
    stopNews: "Geen InFlight-nieuws meer per e-mail",
    stopNotices: "Geen e-mails meer over je gedeelde projecten",
    confirmNews: "Druk op de knop om InFlight-nieuws per e-mail te stoppen. Accountmails, zoals een licentiesleutel, komen nog steeds.",
    confirmNotices: "Druk op de knop om e-mails over je gedeelde projecten te stoppen. In de app zie je ze nog steeds.",
    doneNews: "Klaar. Zet nieuws per e-mail weer aan via Instellingen → Account in InFlight.",
    doneNotices: "Klaar. Zet deze e-mails weer aan via Instellingen → Account in InFlight.",
  },
  news: {
    why: "Je krijgt dit omdat je hebt gevraagd om InFlight-nieuws per e-mail. Om te stoppen, zet je het uit in Instellingen → Account, of gebruik je de link hieronder.",
  },
};
