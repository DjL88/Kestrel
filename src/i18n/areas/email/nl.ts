import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch. DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} heeft je uitgenodigd voor ‘${project}’ op InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} heeft je uitgenodigd voor het InFlight-project ‘${project}’ ${as}.`,
    as: { editor: "als bewerker", commenter: "als commentator", viewer: "als kijker", client: "als klant" },
    join: "Open InFlight en meld je aan met dit e-mailadres om mee te doen.",
    open: "InFlight openen",
    ignore: "Niet verwacht? Dan kun je dit negeren. Er gebeurt niets als je niet accepteert.",
    stop: "Geen uitnodigingen meer naar dit adres",
    someone: "Iemand",
  },
  unsubscribe: {
    title: "Geen uitnodigingen meer",
    confirm: "Druk op de knop om geen uitnodigingen meer naar dit adres te krijgen.",
    button: "Geen uitnodigingen meer",
    done: "Klaar. InFlight stuurt geen uitnodigingen meer naar dit adres.",
    invalid: "Deze link is niet geldig.",
    invalidHint: "Beantwoord de e-mail, dan stoppen we ermee.",
  },
};
