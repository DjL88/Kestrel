import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} kutsui sinut projektiin ”${project}” InFlightissa`,
    invited: (inviter: string, project: string, as: string) => `${inviter} kutsui sinut InFlight-projektiin ”${project}” ${as}.`,
    as: { editor: "muokkaajaksi", commenter: "kommentoijaksi", viewer: "katselijaksi", client: "asiakkaaksi" },
    join: "Liity avaamalla InFlight ja kirjautumalla sisään tällä osoitteella.",
    open: "Avaa InFlight",
    ignore: "Etkö odottanut tätä? Voit jättää viestin huomiotta. Mitään ei tapahdu, ellet hyväksy.",
    stop: "Älä lähetä enää kutsuja tähän osoitteeseen",
    someone: "Joku",
  },
  unsubscribe: {
    title: "Ei enää kutsuja",
    confirm: "Paina painiketta, niin tähän osoitteeseen ei lähetetä enää kutsuja.",
    button: "Ei enää kutsuja",
    done: "Valmis. InFlight ei lähetä enää kutsuja tähän osoitteeseen.",
    invalid: "Linkki ei ole kelvollinen.",
    invalidHint: "Vastaa viestiin, niin lopetamme.",
  },
};
