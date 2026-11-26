import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} har invitert deg til «${project}» på InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} har invitert deg til InFlight-prosjektet «${project}» ${as}.`,
    as: { editor: "som redaktør", commenter: "som kommentator", viewer: "som seer", client: "som kunde" },
    join: "Åpne InFlight og logg inn med denne e-postadressen for å bli med.",
    open: "Åpne InFlight",
    ignore: "Ventet du ikke dette? Da kan du se bort fra det. Ingenting skjer hvis du ikke godtar.",
    stop: "Ingen flere e-poster fra InFlight til denne adressen",
    someone: "Noen",
  },
  unsubscribe: {
    title: "Ingen flere e-poster fra InFlight",
    confirm: "Trykk på knappen for ikke å få flere e-poster fra InFlight til denne adressen.",
    button: "Ingen flere e-poster",
    done: "Ferdig. InFlight sender ikke flere e-poster til denne adressen.",
    invalid: "Lenken er ikke gyldig.",
    invalidHint: "Svar på e-posten, så stopper vi dem.",
    stopNews: "Stopp nyheter fra InFlight på e-post",
    stopNotices: "Stopp e-post om de delte prosjektene dine",
    confirmNews: "Trykk på knappen for å stoppe nyheter fra InFlight på e-post. E-post om kontoen, som en lisensnøkkel, kommer fortsatt.",
    confirmNotices: "Trykk på knappen for å stoppe e-post om de delte prosjektene dine. Du ser dem fortsatt i appen.",
    doneNews: "Ferdig. Slå nyheter på e-post på igjen under Innstillinger → Konto i InFlight.",
    doneNotices: "Ferdig. Slå denne e-posten på igjen under Innstillinger → Konto i InFlight.",
  },
  news: {
    why: "Du får dette fordi du har bedt om nyheter fra InFlight på e-post. Slå det av under Innstillinger → Konto, eller bruk lenken nedenfor.",
  },
};
