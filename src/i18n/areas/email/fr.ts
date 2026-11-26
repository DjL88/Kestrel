import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French. DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} vous invite à « ${project} » sur InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} vous invite au projet InFlight « ${project} » ${as}.`,
    as: { editor: "en tant qu’éditeur", commenter: "en tant que commentateur", viewer: "en tant que lecteur", client: "en tant que client" },
    join: "Pour rejoindre le projet, ouvrez InFlight et connectez-vous avec cette adresse e-mail.",
    open: "Ouvrir InFlight",
    ignore: "Vous ne vous y attendiez pas ? Vous pouvez ignorer ce message. Rien ne se passe sans votre accord.",
    stop: "Ne plus recevoir d’e-mails d’InFlight à cette adresse",
    someone: "Quelqu’un",
  },
  unsubscribe: {
    title: "Ne plus recevoir d’e-mails d’InFlight",
    confirm: "Appuyez sur le bouton pour ne plus recevoir aucun e-mail d’InFlight à cette adresse.",
    button: "Ne plus recevoir d’e-mails",
    done: "C’est fait. InFlight n’enverra plus d’e-mails à cette adresse.",
    invalid: "Ce lien n’est pas valide.",
    invalidHint: "Répondez à l’e-mail et nous arrêterons les envois.",
    stopNews: "Ne plus recevoir les actualités d’InFlight par e-mail",
    stopNotices: "Ne plus recevoir d’e-mails sur vos projets partagés",
    confirmNews: "Appuyez sur le bouton pour ne plus recevoir les actualités d’InFlight par e-mail. Les e-mails liés à votre compte, comme une clé de licence, arrivent toujours.",
    confirmNotices: "Appuyez sur le bouton pour ne plus recevoir d’e-mails sur vos projets partagés. Vous les voyez toujours dans l’application.",
    doneNews: "C’est fait. Pour réactiver les actualités par e-mail, ouvrez Réglages → Compte dans InFlight.",
    doneNotices: "C’est fait. Pour réactiver ces e-mails, ouvrez Réglages → Compte dans InFlight.",
  },
  news: {
    why: "Vous recevez ce message car vous avez demandé les nouveautés d’InFlight par e-mail. Pour arrêter, désactivez-les dans Paramètres → Compte, ou utilisez le lien ci-dessous.",
  },
};
