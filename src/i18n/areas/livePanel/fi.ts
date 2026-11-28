import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  open: `Suora kuvaus`,
  openHint: `Aloita suora kuvaus: kuvat tulevat tähän projektiin sitä mukaa kuin kuvaat.`,
  title: `Suora kuvaus`,
  intro: `Kuvat tulevat tähän projektiin sitä mukaa kuin kuvaat. Kamerassa tai kansiossa ei muuteta mitään. Ei vielä testattu oikealla kameralla.`,
  source: `Mistä kuvat tulevat`,
  folder: `Kansio`,
  folderHint: `Tether-sovellus tai muu ohjelma tallentaa kuvat valitsemaasi kansioon.`,
  ftpHint: `Kamera lähettää jokaisen kuvan tälle tietokoneelle lähiverkon kautta.`,
  usbHint: `Esikatseluominaisuus: kokeiltu toistaiseksi vain simuloidulla kameralla.`,
  look: `Tyyli seuraaville kuville`,
  lookNone: `Ei mitään: kuvat tulevat sellaisinaan`,
  lookNote: `Jokainen uusi kuva saa tämän tyylin omaksi muokkauksekseen. Tyylit › Ei mitään tai Palauta poistaa sen. Alkuperäistä tiedostoa ei koskaan muuteta.`,
  room: `Näytä tämän verkon muilla näytöillä`,
  roomNote: `Asiakkaan tabletti tai studion näyttö voi nähdä kuvat ja lisätä tähtiä ja valintoja. Omat merkintäsi ovat aina etusijalla.`,
  start: `Aloita suora kuvaus`,
  stop: `Lopeta suora kuvaus`,
  close: `Sulje ja lopeta`,
  closeNote: `Tämän paneelin sulkeminen lopettaa suoran kuvauksen ja sammuttaa kameran saapuvien kansion ja huoneen.`,
  running: (n: number) => plural(n, { one: `Suora kuvaus käynnissä · ${n} kuva tähän mennessä`, other: `Suora kuvaus käynnissä · ${n} kuvaa tähän mennessä` }),
  lookOn: (name: string) => `Tyyli seuraaville kuville: ${name}`,
  ftpSame: `Nämä pysyvät samoina joka kerta tällä tietokoneella, joten kamera säilyttää asetuksensa.`,
  portChanged: (port: number) => `Tavallinen portti oli käytössä, joten tämä kuvaus käyttää porttia ${port}. Kirjoita se kameraan tai sulje toinen ohjelma ja aloita alusta.`,
  newPassword: `Luo uusi salasana`,
  newPasswordNote: `Kirjoita sitten uusi salasana kameraan.`,
  roomHeading: `Avaa tämä osoite toisella näytöllä`,
  starting: `Käynnistetään…`,
};
