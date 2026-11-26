import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  menu: (n: number) => `${n} Fotos zu HDR zusammenführen`,
  menuHint: "Verbindet eine Reihe dunklerer und hellerer Fotos zu einem neuen 16-Bit-Foto, das Lichter und Schatten bewahrt. Die Originale werden nicht verändert.",
  task: (n: number) => `${n} Fotos werden zu HDR zusammengeführt`,
  reading: "Fotos werden gelesen",
  aligning: "Fotos werden ausgerichtet",
  merging: "Belichtungen werden zusammengeführt",
  saving: "HDR-Foto wird hinzugefügt",
  done: (name: string, n: number) => `${name} hinzugefügt, zusammengeführt aus ${n} Fotos. Ihre Originalfotos bleiben unverändert.`,
  cancelled: "HDR-Zusammenführung angehalten. Nichts wurde hinzugefügt. Ihre Originalfotos bleiben unverändert.",
  failed: "Die HDR-Zusammenführung wurde nicht abgeschlossen. Den Grund finden Sie unter Aufgaben. Ihre Originalfotos bleiben unverändert.",
  tooFew: "Wählen Sie mindestens zwei Fotos derselben Szene, dunkler und heller aufgenommen, für HDR. Ihre Originalfotos bleiben unverändert.",
  tooMany: (max: number) => `Wählen Sie für HDR höchstens ${max} Fotos auf einmal. Ihre Originalfotos bleiben unverändert.`,
  sizeMismatch: "Diese Fotos sind unterschiedlich groß und lassen sich deshalb nicht ausrichten. Ihre Originalfotos bleiben unverändert.",
  sameExposure: "Diese Fotos scheinen gleich belichtet zu sein, deshalb gibt es nichts zusammenzuführen. Wählen Sie eine dunkler und heller aufgenommene Reihe. Ihre Originalfotos bleiben unverändert.",
  unrelated: (n: number) => `Foto ${n} lässt sich nicht klar genug mit den anderen ausrichten, deshalb wurde nichts zusammengeführt, statt zu raten. Wählen Sie Bilder aus einer Reihe. Ihre Originalfotos bleiben unverändert.`,
  unsupported: (name: string) => `${name} kann hier nicht in voller Größe gelesen werden, deshalb wurde nichts zusammengeführt. Es wurde kein kleineres Bild ersatzweise verwendet. Ihre Originalfotos bleiben unverändert.`,
  rawNotDeveloped: (name: string) => `${name} konnte hier nicht mit 16 Bit aus den Sensordaten entwickelt werden, und die kleine eingebettete Vorschau der Kamera wird für HDR nicht verwendet. Verbinden Sie das Original erneut und versuchen Sie es noch einmal. Ihre Originalfotos bleiben unverändert.`,
  tooLarge: "Diese Fotos sind zu groß, um sie auf diesem Gerät sicher zusammenzuführen. Nichts wurde zusammengeführt. Ihre Originalfotos bleiben unverändert.",
  ghostsRemoved: "Zwischen den Fotos hat sich etwas bewegt. Dort verwendet die Zusammenführung nur ein Foto, damit nichts doppelt erscheint.",
  highlightsClipped: "Einige Lichter waren selbst im dunkelsten Foto zu hell und bleiben deshalb weiß.",
  mainThread: "Es lief im Vordergrund, weil Hintergrundarbeit hier nicht verfügbar ist, daher hat die App möglicherweise kurz gestockt.",
  infoTitle: "HDR-Zusammenführung",
  infoMadeFrom: (n: number) => plural(n, { one: `Aus ${n} Foto erstellt:`, other: `Aus ${n} Fotos erstellt:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} Blenden`,
  infoHow: "Jeder Bereich stammt aus den Fotos, die dort gut belichtet waren, ausgerichtet und nach Belichtung gewichtet, dann mit Lichtern und Schatten des Editors abgestimmt. Es wurden keine Pixel erzeugt.",
  whatIs: "HDR heißt hoher Dynamikumfang, nicht hohe Auflösung. Es verbindet mehrere Belichtungen derselben Szene, damit helle Himmel und dunkle Schatten ihre Details behalten.",
  bracketTitle: "Belichtungsreihe",
  bracketFound: (n: number, stops: string) => `${n} Fotos, kurz nacheinander mit unterschiedlicher Belichtung aufgenommen (${stops} Blenden).`,
  bracketFromCamera: "Ihre Kamera hat diese Fotos als Belichtungsreihe markiert.",
  bracketFromExposures: "Erkannt an Verschlusszeit, Blende und ISO.",
};
