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
    stop: "Ne plus recevoir d’invitations à cette adresse",
    someone: "Quelqu’un",
  },
  unsubscribe: {
    title: "Ne plus recevoir d’invitations",
    confirm: "Appuyez sur le bouton pour ne plus recevoir d’invitations à cette adresse.",
    button: "Ne plus recevoir d’invitations",
    done: "C’est fait. InFlight n’enverra plus d’invitations à cette adresse.",
    invalid: "Ce lien n’est pas valide.",
    invalidHint: "Répondez à l’e-mail et nous arrêterons les envois.",
  },
};
