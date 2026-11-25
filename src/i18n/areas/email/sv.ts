import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} har bjudit in dig till ”${project}” på InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} har bjudit in dig till InFlight-projektet ”${project}” ${as}.`,
    as: { editor: "som redigerare", commenter: "som kommentator", viewer: "som tittare", client: "som kund" },
    join: "Öppna InFlight och logga in med den här e-postadressen för att gå med.",
    open: "Öppna InFlight",
    ignore: "Väntade du dig inte detta? Då kan du strunta i det. Inget händer om du inte godkänner.",
    stop: "Skicka inga fler inbjudningar till den här adressen",
    someone: "Någon",
  },
  unsubscribe: {
    title: "Inga fler inbjudningar",
    confirm: "Tryck på knappen för att inte få fler inbjudningar till den här adressen.",
    button: "Inga fler inbjudningar",
    done: "Klart. InFlight skickar inga fler inbjudningar till den här adressen.",
    invalid: "Länken är inte giltig.",
    invalidHint: "Svara på mejlet, så slutar vi.",
  },
};
