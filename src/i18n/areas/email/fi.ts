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
    stopNews: "Lopeta InFlight-uutiset sähköpostissa",
    stopNotices: "Lopeta sähköpostit jaetuista projekteistasi",
    confirmNews: "Paina painiketta, niin InFlight-uutisia ei enää lähetetä sähköpostiin. Tiliä koskevat viestit, kuten lisenssiavain, tulevat yhä.",
    confirmNotices: "Paina painiketta, niin jaetuista projekteistasi ei enää lähetetä sähköpostia. Näet ne yhä sovelluksessa.",
    doneNews: "Valmis. Voit ottaa uutiset sähköpostiin taas käyttöön InFlightissa kohdassa Asetukset → Tili.",
    doneNotices: "Valmis. Voit ottaa nämä viestit taas käyttöön InFlightissa kohdassa Asetukset → Tili.",
  },
  news: {
    why: "Saat tämän, koska pyysit InFlightin uutisia sähköpostilla. Voit lopettaa ne kohdassa Asetukset → Tili tai alla olevalla linkillä.",
  },
};
