import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German. DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} hat Sie zu „${project}“ auf InFlight eingeladen`,
    invited: (inviter: string, project: string, as: string) => `${inviter} hat Sie zum InFlight-Projekt „${project}“ ${as} eingeladen.`,
    as: { editor: "als Bearbeiter", commenter: "als Kommentator", viewer: "als Betrachter", client: "als Kunde" },
    join: "Öffnen Sie InFlight und melden Sie sich mit dieser E-Mail-Adresse an, um beizutreten.",
    open: "InFlight öffnen",
    ignore: "Nicht erwartet? Dann ignorieren Sie diese E-Mail. Ohne Ihre Zustimmung passiert nichts.",
    stop: "Keine E-Mails mehr von InFlight an diese Adresse",
    someone: "Jemand",
  },
  unsubscribe: {
    title: "Keine E-Mails mehr von InFlight",
    confirm: "Tippen Sie auf die Schaltfläche, um keine E-Mails von InFlight mehr an diese Adresse zu erhalten.",
    button: "Keine E-Mails mehr",
    done: "Erledigt. InFlight schickt keine E-Mails mehr an diese Adresse.",
    invalid: "Dieser Link ist ungültig.",
    invalidHint: "Antworten Sie auf die E-Mail, dann stoppen wir sie.",
    stopNews: "Keine InFlight-Neuigkeiten mehr per E-Mail",
    stopNotices: "Keine E-Mails mehr zu Ihren geteilten Projekten",
    confirmNews: "Tippen Sie auf die Schaltfläche, um InFlight-Neuigkeiten per E-Mail zu beenden. Konto-E-Mails, etwa ein Lizenzschlüssel, kommen weiter an.",
    confirmNotices: "Tippen Sie auf die Schaltfläche, um E-Mails zu Ihren geteilten Projekten zu beenden. In der App sehen Sie sie weiter.",
    doneNews: "Erledigt. Um Neuigkeiten per E-Mail wieder einzuschalten, öffnen Sie in InFlight Einstellungen → Konto.",
    doneNotices: "Erledigt. Um diese E-Mails wieder einzuschalten, öffnen Sie in InFlight Einstellungen → Konto.",
  },
  news: {
    why: "Sie erhalten diese E-Mail, weil Sie InFlight-Neuigkeiten per E-Mail angefordert haben. Zum Beenden schalten Sie dies unter Einstellungen → Konto aus oder nutzen Sie den Link unten.",
  },
};
