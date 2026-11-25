import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fokus-Stacking aus ${n} Fotos`,
  menuHint: "Verbindet die schärfsten Bereiche jedes Fotos zu einem neuen Foto. Die Originale werden nicht verändert.",
  task: (n: number) => `Fokus-Stacking aus ${n} Fotos`,
  reading: "Fotos werden gelesen",
  aligning: "Fotos werden ausgerichtet",
  blending: "Die schärfsten Bereiche werden verbunden",
  saving: "Gestapeltes Foto wird hinzugefügt",
  done: (name: string, n: number) => `${name} hinzugefügt, gestapelt aus ${n} Fotos. Ihre Originalfotos bleiben unverändert.`,
  cancelled: "Fokus-Stacking angehalten. Nichts wurde hinzugefügt. Ihre Originalfotos bleiben unverändert.",
  failed: "Das Fokus-Stacking wurde nicht abgeschlossen. Den Grund finden Sie unter Aufgaben. Ihre Originalfotos bleiben unverändert.",
  tooFew: "Wählen Sie mindestens zwei Fotos derselben Szene. Ihre Originalfotos bleiben unverändert.",
  tooMany: (max: number) => `Wählen Sie höchstens ${max} Fotos auf einmal. Ihre Originalfotos bleiben unverändert.`,
  sizeMismatch: "Diese Fotos sind unterschiedlich groß und lassen sich deshalb nicht ausrichten. Ihre Originalfotos bleiben unverändert.",
  unrelated: (n: number) => `Foto ${n} zeigt anscheinend nicht dieselbe Szene wie sein Nachbar, deshalb wurde nichts gestapelt. Wählen Sie Bilder aus einer Serie. Ihre Originalfotos bleiben unverändert.`,
  ambiguous: (n: number) => `Es ist unklar, wie Foto ${n} zu seinem Nachbarn passt (sich wiederholendes Muster oder zu viel Bewegung). Statt zu raten, wurde nichts gestapelt. Ihre Originalfotos bleiben unverändert.`,
  tooFlat: (n: number) => `Foto ${n} hat zu wenig Details zum Ausrichten. Statt zu raten, wurde nichts gestapelt. Ihre Originalfotos bleiben unverändert.`,
  unsupported: (name: string) => `${name} kann hier nicht in voller Größe gelesen werden, deshalb wurde nichts gestapelt. Es wurde kein kleineres Bild ersatzweise verwendet. Ihre Originalfotos bleiben unverändert.`,
  rawNotDeveloped: (name: string) => `${name} hat noch keine Entwicklung in voller Größe aus den Sensordaten, und die kleine eingebettete Vorschau der Kamera wird nicht zum Stacking verwendet. Erstellen Sie zuerst die Entwicklung in voller Größe. Ihre Originalfotos bleiben unverändert.`,
  tooLarge: "Diese Fotos sind zu groß, um sie auf diesem Gerät sicher zu stapeln. Nichts wurde gestapelt. Ihre Originalfotos bleiben unverändert.",
  equallySharp: "Diese Fotos wirken überall gleich scharf, daher sieht der Stapel den Originalen womöglich sehr ähnlich.",
  frameUnused: (n: number) => `Foto ${n} hat fast nichts zum Stapel beigetragen.`,
  oneFrameDominates: "Ein Foto lieferte fast alle Details. Prüfen Sie, ob die Fotos mit unterschiedlichen Fokusabständen aufgenommen wurden.",
  localFallback: (n: number) => `Foto ${n} wurde nur als Ganzes ausgerichtet: Für eine feinere Ausrichtung gab es zu wenig übereinstimmende Details.`,
  infoTitle: "Fokus-Stacking",
  infoMadeFrom: (n: number) => plural(n, { one: `Aus ${n} Foto erstellt:`, other: `Aus ${n} Fotos erstellt:` }),
  infoHow: "Jeder Bereich stammt aus dem dort schärfsten Foto, weich überblendet. Es wurden keine Pixel erzeugt.",
};
