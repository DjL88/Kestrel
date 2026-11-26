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
    stop: "Ingen flere e-mails fra InFlight til denne adresse",
    someone: "Nogen",
  },
  unsubscribe: {
    title: "Ingen flere e-mails fra InFlight",
    confirm: "Tryk på knappen for ikke at få flere e-mails fra InFlight til denne adresse.",
    button: "Ingen flere e-mails",
    done: "Færdig. InFlight sender ikke flere e-mails til denne adresse.",
    invalid: "Dette link er ikke gyldigt.",
    invalidHint: "Svar på mailen, så stopper vi dem.",
    stopNews: "Stop nyheder fra InFlight på mail",
    stopNotices: "Stop mails om dine delte projekter",
    confirmNews: "Tryk på knappen for at stoppe nyheder fra InFlight på mail. Mails om din konto, fx en licensnøgle, kommer stadig.",
    confirmNotices: "Tryk på knappen for at stoppe mails om dine delte projekter. Du ser dem stadig i appen.",
    doneNews: "Færdig. Slå nyheder på mail til igen under Indstillinger → Konto i InFlight.",
    doneNotices: "Færdig. Slå disse mails til igen under Indstillinger → Konto i InFlight.",
  },
  news: {
    why: "Du får dette, fordi du har bedt om nyheder fra InFlight på e-mail. Slå det fra under Indstillinger → Konto, eller brug linket nedenfor.",
  },
};
