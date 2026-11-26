import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  welcome: {
    title: "Willkommen bei InFlight",
    intro: "Drei Dinge, die Sie vor dem Start wissen sollten:",
    originals: "Ihre Originalfotos bleiben, wo sie sind. InFlight verändert, verschiebt oder ersetzt sie nie.",
    undo: "Jede Bearbeitung lässt sich rückgängig machen. InFlight speichert ein Rezept Ihrer Änderungen, keine neue Kopie des Fotos.",
    backup: "Eine Projektsicherung enthält Ihre Entscheidungen, Bewertungen und Bearbeitungen, aber nicht die RAW-Dateien selbst. Sichern Sie Ihre Originale zusätzlich.",
    webNote: "Im Webbrowser bittet InFlight den Browser beim Fortfahren, seinen Speicher zu behalten. Was das bedeutet, steht in den Einstellungen unter Speicher.",
    done: "Verstanden",
  },
  browserStorage: {
    title: "Speicher dieses Browsers",
    checking: "Es wird geprüft, was dieser Browser behält …",
    standard: "Dieser Browser kann den Speicher von InFlight löschen, wenn der Platz knapp wird oder Websitedaten gelöscht werden.",
    requesting: "Der Browser wird gebeten, den Speicher von InFlight zu behalten …",
    persistent: "Dieser Browser hat zugestimmt, den Speicher von InFlight zu behalten. Wenn Sie Websitedaten selbst löschen, wird er trotzdem entfernt.",
    declined: "Der Browser hat nicht zugestimmt, den Speicher von InFlight zu behalten. Das entscheidet er selbst, oft danach, wie oft Sie die Seite nutzen. Sie können später erneut fragen.",
    unavailable: "Dieser Browser kann nicht zusagen, den Speicher von InFlight zu behalten.",
    ask: "Browser bitten, den Speicher zu behalten",
    kept: "Speicher wird behalten",
    permissionsTitle: "Dateiberechtigungen",
    permissions: "Der Browser lässt InFlight nur die Fotos und Ordner lesen, die Sie auswählen. Nach dem Schließen des Tabs oder einem Neustart fragt er Sie vielleicht erneut, bevor InFlight einen Ordner sehen kann. Ein Nein schadet Ihren Fotos nicht; InFlight kann sie nur nicht zeigen, bis Sie es erlauben.",
    forgetTitle: "Was der Browser vergessen kann",
    forget: "Ihre Projekte, Entscheidungen, Bearbeitungen und Vorschauen liegen in diesem Browser. Das Löschen von Browserdaten, ein privates Fenster oder das Deinstallieren des Browsers kann sie entfernen. Ihre Originalfotos werden dabei nie gespeichert oder verändert, sie sind also sicher.",
    backupHint: "Erstellen Sie zur Sicherheit eine Projektsicherung über die Projektoptionen und bewahren Sie sie zusammen mit Ihren Originalen außerhalb dieses Browsers auf.",
  },
};
