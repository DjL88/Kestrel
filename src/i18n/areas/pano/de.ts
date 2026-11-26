import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  menu: (n: number) => `${n} Fotos zu einem Panorama zusammenfügen`,
  menuHint: "Fügt sich überlappende Fotos zu einem neuen breiten Foto zusammen, zugeschnitten auf echte Pixel. Die Originale werden nicht verändert.",
  task: (n: number) => `Panorama aus ${n} Fotos wird zusammengefügt`,
  reading: "Fotos werden gelesen",
  matching: "Überlappungen werden gesucht",
  placing: "Fotos werden platziert",
  blending: "Übergänge werden verblendet",
  saving: "Panorama wird hinzugefügt",
  done: (name: string, n: number) => `${name} hinzugefügt, zusammengefügt aus ${n} Fotos. Ihre Originalfotos bleiben unverändert.`,
  cropNote: (percent: number) => `Zugeschnitten auf die ${percent} % der Fläche, die echte Pixel abdecken. Nichts wurde aufgefüllt.`,
  cancelled: "Zusammenfügen angehalten. Nichts wurde hinzugefügt. Ihre Originalfotos bleiben unverändert.",
  failed: "Das Panorama wurde nicht fertig. Öffnen Sie Aufgaben, um den Grund zu sehen. Ihre Originalfotos bleiben unverändert.",
  tooFew: "Wählen Sie mindestens zwei sich überlappende Fotos. Ihre Originalfotos bleiben unverändert.",
  tooMany: (max: number) => `Wählen Sie höchstens ${max} Fotos auf einmal. Ihre Originalfotos bleiben unverändert.`,
  sizeMismatch: "Diese Fotos sind unterschiedlich groß, deshalb wurden sie nicht zusammengefügt. Ihre Originalfotos bleiben unverändert.",
  tooFlat: (n: number) => `Foto ${n} hat zu wenig Details zum Ausrichten, deshalb wurde nichts zusammengefügt, statt zu raten. Ihre Originalfotos bleiben unverändert.`,
  unrelated: (n: number) => `Foto ${n} überlappt das vorherige Foto nicht genug, um beide auszurichten, deshalb wurde nichts zusammengefügt. Wählen Sie die Fotos in Aufnahmereihenfolge, jedes etwa ein Drittel über dem nächsten. Ihre Originalfotos bleiben unverändert.`,
  ambiguous: (n: number) => `Es ist unklar, wo Foto ${n} an das vorherige anschließt. Das Muster wiederholt sich, oder die Kamera war zu stark geneigt, deshalb wurde nichts zusammengefügt, statt zu raten. Ihre Originalfotos bleiben unverändert.`,
  vertical: "Diese Fotos verlaufen von oben nach unten statt seitlich. Senkrechte Panoramen werden noch nicht unterstützt, deshalb wurde nichts zusammengefügt. Ihre Originalfotos bleiben unverändert.",
  tooLarge: "Dieses Panorama wäre zu groß, um es auf diesem Gerät sicher zu erstellen, und es wird nicht ungefragt verkleinert. Wählen Sie weniger Fotos. Ihre Originalfotos bleiben unverändert.",
  noCoverage: "Die Fotos ergeben kein Rechteck aus echten Pixeln, deshalb wurde nichts zusammengefügt, statt Lücken zu füllen. Ihre Originalfotos bleiben unverändert.",
  unsupported: (name: string) => `${name} kann hier nicht in voller Größe gelesen werden, deshalb wurde nichts zusammengefügt. Es wurde kein kleineres Bild ersatzweise verwendet. Ihre Originalfotos bleiben unverändert.`,
  rawNotDeveloped: (name: string) => `${name} hat noch keine Entwicklung in voller Größe aus den Sensordaten, und die kleine eingebettete Vorschau der Kamera wird für Panoramen nicht verwendet. Erstellen Sie zuerst die Entwicklung in voller Größe. Ihre Originalfotos bleiben unverändert.`,
  exposureDiffers: "Die Fotos wurden mit recht unterschiedlicher Helligkeit aufgenommen. Sie wurden angeglichen, prüfen Sie aber den Himmel auf Streifen.",
  seamsVisible: "Manche Übergänge können sichtbar sein: Zwischen den Fotos hat sich etwas bewegt, oder die Kamera wurde verschoben statt gedreht.",
  focalEstimated: "Die Brennweite des Objektivs war nicht gespeichert, deshalb wurde sie aus den Fotos ermittelt.",
  mainThread: "Es lief im Vordergrund, weil Hintergrundarbeit hier nicht verfügbar ist, daher hat die App möglicherweise kurz gestockt.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Zusammengefügt aus ${n} Foto:`, other: `Zusammengefügt aus ${n} Fotos:` }),
  infoHow: "Auf einen Zylinder gelegt, Übergänge weich verblendet und auf echte Pixel zugeschnitten. Es wurden keine Pixel erzeugt.",
};
