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
    stop: "Ikke send flere invitasjoner til denne adressen",
    someone: "Noen",
  },
  unsubscribe: {
    title: "Ingen flere invitasjoner",
    confirm: "Trykk på knappen for ikke å få flere invitasjoner til denne adressen.",
    button: "Ingen flere invitasjoner",
    done: "Ferdig. InFlight sender ikke flere invitasjoner til denne adressen.",
    invalid: "Lenken er ikke gyldig.",
    invalidHint: "Svar på e-posten, så stopper vi dem.",
  },
};
