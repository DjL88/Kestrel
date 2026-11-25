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
    stop: "Älä lähetä enää sähköpostia InFlightista tähän osoitteeseen",
    someone: "Joku",
  },
  unsubscribe: {
    title: "Ei enää sähköpostia InFlightista",
    confirm: "Paina painiketta, niin InFlight ei lähetä enää sähköpostia tähän osoitteeseen.",
    button: "Ei enää sähköpostia",
    done: "Valmis. InFlight ei lähetä enää sähköpostia tähän osoitteeseen.",
    invalid: "Linkki ei ole kelvollinen.",
    invalidHint: "Vastaa viestiin, niin lopetamme.",
  },
  news: {
    why: "Saat tämän, koska pyysit InFlightin uutisia sähköpostilla. Voit lopettaa ne kohdassa Asetukset → Tili tai alla olevalla linkillä.",
  },
};
