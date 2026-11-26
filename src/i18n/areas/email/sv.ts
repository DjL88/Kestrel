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
    stop: "Inga fler mejl från InFlight till den här adressen",
    someone: "Någon",
  },
  unsubscribe: {
    title: "Inga fler mejl från InFlight",
    confirm: "Tryck på knappen för att inte få fler mejl från InFlight till den här adressen.",
    button: "Inga fler mejl",
    done: "Klart. InFlight skickar inga fler mejl till den här adressen.",
    invalid: "Länken är inte giltig.",
    invalidHint: "Svara på mejlet, så slutar vi.",
    stopNews: "Sluta få nyheter från InFlight via mejl",
    stopNotices: "Sluta få mejl om dina delade projekt",
    confirmNews: "Tryck på knappen för att sluta få nyheter från InFlight via mejl. Mejl om ditt konto, till exempel en licensnyckel, kommer fortfarande.",
    confirmNotices: "Tryck på knappen för att sluta få mejl om dina delade projekt. Du ser dem fortfarande i appen.",
    doneNews: "Klart. Slå på nyheter via mejl igen under Inställningar → Konto i InFlight.",
    doneNotices: "Klart. Slå på de här mejlen igen under Inställningar → Konto i InFlight.",
  },
  news: {
    why: "Du får detta eftersom du har bett om nyheter från InFlight via e-post. Stäng av det under Inställningar → Konto, eller använd länken nedan.",
  },
};
