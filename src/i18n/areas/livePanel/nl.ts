import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  open: `Live fotograferen`,
  openHint: `Start live fotograferen: foto's komen in dit project terwijl u fotografeert.`,
  title: `Live fotograferen`,
  intro: `Foto's komen in dit project terwijl u fotografeert. Er verandert niets op de camera of in de map. Nog niet getest met een echte camera.`,
  source: `Waar de foto's vandaan komen`,
  folder: `Een map`,
  folderHint: `Een tether-app of ander programma bewaart foto's in een map die u kiest.`,
  ftpHint: `De camera stuurt elke foto via het lokale netwerk naar deze computer.`,
  usbHint: `Een voorproefje: tot nu toe alleen geprobeerd met een gesimuleerde camera.`,
  look: `Look voor de volgende opnamen`,
  lookNone: `Geen: foto's komen binnen zoals gemaakt`,
  lookNote: `Elke nieuwe foto krijgt deze look als eigen bewerking. Looks › Geen of Herstellen haalt hem weg. Het originele bestand wordt nooit gewijzigd.`,
  room: `Tonen op andere schermen in dit netwerk`,
  roomNote: `De tablet van een klant of een studioscherm kan de foto's zien en sterren en keuzes toevoegen. Uw eigen markeringen gaan altijd voor.`,
  start: `Live fotograferen starten`,
  stop: `Live fotograferen stoppen`,
  close: `Sluiten en stoppen`,
  closeNote: `Als u dit paneel sluit, stopt het live fotograferen en gaan de camera-inbox en de ruimte uit.`,
  running: (n: number) => plural(n, { one: `Live fotograferen bezig · tot nu toe ${n} foto`, other: `Live fotograferen bezig · tot nu toe ${n} foto's` }),
  lookOn: (name: string) => `Look voor de volgende opnamen: ${name}`,
  ftpSame: `Deze blijven op deze computer elke keer hetzelfde, dus de camera houdt zijn instellingen.`,
  portChanged: (port: number) => `De gebruikelijke poort was bezet, dus deze sessie gebruikt poort ${port}. Typ die in de camera, of sluit het andere programma en begin opnieuw.`,
  newPassword: `Nieuw wachtwoord maken`,
  newPasswordNote: `Typ daarna het nieuwe wachtwoord in de camera.`,
  roomHeading: `Open dit adres op het andere scherm`,
  starting: `Bezig met starten…`,
};
