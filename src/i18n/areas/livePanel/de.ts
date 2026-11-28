import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  open: `Live-Shooting`,
  openHint: `Starten Sie ein Live-Shooting: Bilder kommen beim Fotografieren in dieses Projekt.`,
  title: `Live-Shooting`,
  intro: `Bilder kommen beim Fotografieren in dieses Projekt. An der Kamera und im Ordner wird nichts geändert. Noch nicht mit einer echten Kamera getestet.`,
  source: `Woher die Bilder kommen`,
  folder: `Ein Ordner`,
  folderHint: `Eine Tethering-App oder ein anderes Programm speichert Bilder in einen Ordner Ihrer Wahl.`,
  ftpHint: `Die Kamera sendet jedes Bild über das lokale Netzwerk an diesen Computer.`,
  usbHint: `Eine Vorschau: bisher nur mit einer simulierten Kamera erprobt.`,
  look: `Look für die nächsten Aufnahmen`,
  lookNone: `Keiner: Bilder kommen wie aufgenommen`,
  lookNote: `Jedes neue Bild erhält diesen Look als eigene Bearbeitung. Looks › Keiner oder Zurücksetzen nimmt ihn wieder ab. Die Originaldatei wird nie verändert.`,
  room: `Auf anderen Bildschirmen in diesem Netzwerk zeigen`,
  roomNote: `Das Tablet eines Kunden oder ein Studiobildschirm kann die Bilder sehen und Sterne und Auswahl vergeben. Ihre eigenen Markierungen haben immer Vorrang.`,
  start: `Live-Shooting starten`,
  stop: `Live-Shooting beenden`,
  close: `Schließen und beenden`,
  closeNote: `Wenn Sie dieses Feld schließen, endet das Live-Shooting, und Kamera-Eingang und Raum werden ausgeschaltet.`,
  running: (n: number) => plural(n, { one: `Live-Shooting läuft · bisher ${n} Bild`, other: `Live-Shooting läuft · bisher ${n} Bilder` }),
  lookOn: (name: string) => `Look für die nächsten Aufnahmen: ${name}`,
  ftpSame: `Diese Angaben bleiben auf diesem Computer jedes Mal gleich, die Kamera behält also ihre Einstellungen.`,
  portChanged: (port: number) => `Der übliche Port war belegt, daher nutzt dieses Shooting Port ${port}. Geben Sie ihn an der Kamera ein, oder schließen Sie das andere Programm und starten Sie neu.`,
  newPassword: `Neues Passwort erstellen`,
  newPasswordNote: `Geben Sie das neue Passwort dann an der Kamera ein.`,
  roomHeading: `Öffnen Sie diese Adresse auf dem anderen Bildschirm`,
  starting: `Wird gestartet…`,
};
