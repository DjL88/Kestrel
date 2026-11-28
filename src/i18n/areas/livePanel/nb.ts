import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  open: `Livefotografering`,
  openHint: `Start en livefotografering: bildene kommer inn i prosjektet mens du fotograferer.`,
  title: `Livefotografering`,
  intro: `Bildene kommer inn i prosjektet mens du fotograferer. Ingenting endres på kameraet eller i mappen. Ennå ikke testet med et ekte kamera.`,
  source: `Hvor bildene kommer fra`,
  folder: `En mappe`,
  folderHint: `En tether-app eller et annet program lagrer bilder i en mappe du velger.`,
  ftpHint: `Kameraet sender hvert bilde til denne datamaskinen over det lokale nettverket.`,
  usbHint: `En forhåndsvisning: så langt bare prøvd med et simulert kamera.`,
  look: `Look for de neste bildene`,
  lookNone: `Ingen: bildene kommer slik de ble tatt`,
  lookNote: `Hvert nye bilde får denne looken som sin egen redigering. Looks › Ingen eller Tilbakestill fjerner den. Originalfilen endres aldri.`,
  room: `Vis på andre skjermer i dette nettverket`,
  roomNote: `En kundes nettbrett eller en studioskjerm kan se bildene og gi stjerner og valg. Dine egne markeringer vinner alltid.`,
  start: `Start livefotografering`,
  stop: `Stopp livefotografering`,
  close: `Lukk og stopp`,
  closeNote: `Når du lukker dette panelet, stopper livefotograferingen, og kamerainnboksen og rommet slås av.`,
  running: (n: number) => plural(n, { one: `Livefotografering pågår · ${n} bilde så langt`, other: `Livefotografering pågår · ${n} bilder så langt` }),
  lookOn: (name: string) => `Look for de neste bildene: ${name}`,
  ftpSame: `De er de samme hver gang på denne datamaskinen, så kameraet beholder innstillingene sine.`,
  portChanged: (port: number) => `Den vanlige porten var opptatt, så denne fotograferingen bruker port ${port}. Skriv den inn i kameraet, eller lukk det andre programmet og start på nytt.`,
  newPassword: `Lag et nytt passord`,
  newPasswordNote: `Skriv deretter det nye passordet inn i kameraet.`,
  roomHeading: `Åpne denne adressen på den andre skjermen`,
  starting: `Starter…`,
};
