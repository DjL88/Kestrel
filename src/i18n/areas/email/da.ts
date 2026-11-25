import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} har inviteret dig til “${project}” på InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} har inviteret dig til InFlight-projektet “${project}” ${as}.`,
    as: { editor: "som redaktør", commenter: "som kommentator", viewer: "som seer", client: "som kunde" },
    join: "Åbn InFlight, og log ind med denne e-mailadresse for at deltage.",
    open: "Åbn InFlight",
    ignore: "Havde du ikke ventet det? Så kan du se bort fra det. Der sker intet, medmindre du accepterer.",
    stop: "Send ikke flere invitationer til denne adresse",
    someone: "Nogen",
  },
  unsubscribe: {
    title: "Ingen flere invitationer",
    confirm: "Tryk på knappen for ikke at få flere invitationer til denne adresse.",
    button: "Ingen flere invitationer",
    done: "Færdig. InFlight sender ikke flere invitationer til denne adresse.",
    invalid: "Dette link er ikke gyldigt.",
    invalidHint: "Svar på mailen, så stopper vi dem.",
  },
};
