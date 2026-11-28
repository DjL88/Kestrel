import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  welcome: {
    title: "Tervetuloa InFlightiin",
    intro: "Kolme asiaa, jotka kannattaa tietää ennen aloittamista:",
    originals: "Alkuperäiset kuvasi pysyvät siellä, missä ne ovat. InFlight ei koskaan muuta, siirrä tai korvaa niitä.",
    undo: "Jokaisen muokkauksen voi perua. InFlight tallentaa reseptin muutoksistasi, ei uutta kopiota kuvasta.",
    backup: "Projektin varmuuskopio säilyttää valintasi, arviosi ja muokkauksesi, mutta ei itse RAW-tiedostoja. Varmuuskopioi myös alkuperäiset kuvat.",
    done: "Selvä",
  },
  browserStorage: {
    title: "Tämän selaimen tallennustila",
    checking: "Tarkistetaan, mitä tämä selain säilyttää…",
    standard: "Tämä selain voi tyhjentää InFlightin tallennustilan, kun tila loppuu tai sivuston tiedot poistetaan.",
    requesting: "Pyydetään selainta säilyttämään InFlightin tallennustila…",
    persistent: "Tämä selain on suostunut säilyttämään InFlightin tallennustilan. Jos poistat sivuston tiedot itse, se poistuu silti.",
    declined: "Selain ei suostunut säilyttämään InFlightin tallennustilaa. Se päättää tästä itse, usein sen mukaan, kuinka paljon käytät sivustoa. Voit pyytää uudelleen myöhemmin.",
    unavailable: "Tämä selain ei voi luvata säilyttävänsä InFlightin tallennustilaa.",
    ask: "Pyydä selainta säilyttämään tallennustila",
    kept: "Tallennustila säilytetään",
    permissionsTitle: "Tiedostojen käyttöoikeudet",
    permissions: "Selain antaa InFlightin lukea vain valitsemiasi kuvia ja kansioita. Kun olet sulkenut välilehden tai käynnistänyt uudelleen, se voi kysyä uudelleen ennen kuin InFlight näkee kansion. Kieltäytyminen ei vahingoita kuviasi; InFlight ei vain voi näyttää niitä ennen kuin sallit sen.",
    forgetTitle: "Mitä selain voi unohtaa",
    forget: "Projektisi, valintasi, muokkauksesi ja esikatselusi ovat tässä selaimessa. Selaustietojen poistaminen, yksityinen ikkuna tai selaimen poistaminen voi hävittää ne. Alkuperäisiä kuviasi ei koskaan tallenneta tai muuteta täällä, joten ne ovat turvassa.",
    backupHint: "Varmuuden vuoksi tee projektin varmuuskopio projektin asetuksista ja säilytä se alkuperäisten kuvien kanssa tämän selaimen ulkopuolella.",
  },
  diskPreviews: {
    title: "Esikatselut tällä tietokoneella",
    intro: "InFlight säilyttää jokaisesta RAW-kuvasta kolme pientä kuvaa omassa kansiossaan: pikkukuvan, katselukopion ja 2 560 px:n älykkään esikatselun. Voit jatkaa kuvan muokkausta, vaikka sen asema ei ole kiinni. Vienti tarvitsee yhä alkuperäisen. Alkuperäisiä kuviasi ei koskaan muuteta.",
    using: "{used} käytössä, {count} kuvaa.",
    checking: "Esikatselukansiota tarkistetaan…",
    limitLabel: "Enimmäiskoko",
    limitDefault: "{size} (suositus tälle tietokoneelle)",
    limitHint: "Noin {count} kuvaa mahtuu. Kun kansio täyttyy, poistetaan esikatselut, joita et ole katsonut pisimpään. Ne tehdään uudelleen, kun avaat kuvat asema kiinnitettynä.",
    clear: "Poista kaikki esikatselut",
    cleared: "Esikatselut poistettu. Ne tehdään uudelleen, kun katsot kuvia.",
    failed: "Esikatselukansiota ei voitu lukea.",
  },
};
