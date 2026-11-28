import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  size: `Exportgröße`,
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Doppelte Größe · ${w} × ${h} px`,
  custom: `Eigene lange Kante`,
  customEdge: `Lange Kante in Pixeln`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Druckauflösung`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `RGB-PDF für Fotolabore, ${dpi} PPI, 3 mm Beschnitt und Schnittrahmen. Kein CMYK und kein zertifiziertes PDF/X.`,
  windows: `Fotos in den einzelnen Fenstern`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Seite ${page}, Hintergrund: ${filename}` : `Seite ${page}, Fenster ${window}: ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px im Foto, angezeigt mit ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Angezeigt mit ${ww} × ${wh} px. Die Größe des Fotos wird beim Export der Collage geprüft.`,
  enlarged: (percent: number) => `Auf ${percent} % vergrößert, daher wirkt es weicher.`,
  sharp: `Genug Pixel für diese Größe.`,
  ppi: (ppi: number) => `${ppi} Pixel pro Zoll.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} Pixel pro Zoll, unter den gewählten ${dpi} DPI, daher wird der Druck weicher.`,
  lowSummary: (n: number) => plural(n, { one: `${n} Fenster hat weniger Pixel, als diese Größe braucht. Wählen Sie eine kleinere Größe oder exportieren Sie trotzdem; es wirkt dann weicher.`, other: `${n} Fenster haben weniger Pixel, als diese Größe braucht. Wählen Sie eine kleinere Größe oder exportieren Sie trotzdem; sie wirken dann weicher.` }),
  exportAnyway: (n: number) => plural(n, { one: `Trotzdem exportieren (${n} weicheres Fenster)`, other: `Trotzdem exportieren (${n} weichere Fenster)` }),
  rawNote: `RAW-Fotos werden von InFlight aus den Sensordaten entwickelt, wie im Editor; eingebettete Kameravorschauen werden nie verwendet. HEIF-Originale werden in einer Collage noch nicht unterstützt.`,
  heif: (filename: string) => `${filename} ist eine HEIF-Datei. Eine Collage kann ihre Pixel in voller Auflösung noch nicht prüfen, daher wurde nichts an ihre Stelle gesetzt.`,
  embedded: (filename: string) => `${filename} hat kein aus den Sensordaten entwickeltes Bild, und eine eingebettete Kameravorschau wird in einer Collage nie verwendet.`,
  done: `Collage exportiert. Ihre Originale sind unverändert.`,
  doneSoft: (n: number) => plural(n, { one: `Collage exportiert. ${n} Fenster wurde vergrößert oder liegt unter der Druckauflösung, wie vor dem Export angezeigt. Ihre Originale sind unverändert.`, other: `Collage exportiert. ${n} Fenster wurden vergrößert oder liegen unter der Druckauflösung, wie vor dem Export angezeigt. Ihre Originale sind unverändert.` }),
};
