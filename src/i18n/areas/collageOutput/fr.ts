import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French (vous). DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  size: `Taille d'export`,
  standard: (w: number, h: number) => `Standard · ${w} × ${h} px`,
  double: (w: number, h: number) => `Deux fois plus grand · ${w} × ${h} px`,
  custom: `Grand côté personnalisé`,
  customEdge: `Grand côté en pixels`,
  customSize: (w: number, h: number) => `${w} × ${h} px`,
  dpi: `Résolution d'impression`,
  dpiOption: (n: number) => `${n} DPI`,
  pdfNote: (dpi: number) => `PDF RVB pour laboratoire photo, ${dpi} PPP, fond perdu de 3 mm et zones de coupe. Ni CMJN ni PDF/X certifié.`,
  windows: `Photos de chaque fenêtre`,
  window: (page: number, window: number, filename: string) => window === 0 ? `Page ${page}, arrière-plan : ${filename}` : `Page ${page}, fenêtre ${window} : ${filename}`,
  pixels: (sw: number, sh: number, ww: number, wh: number) => `${sw} × ${sh} px dans la photo, affichée en ${ww} × ${wh} px`,
  unknown: (ww: number, wh: number) => `Affichée en ${ww} × ${wh} px. La taille de la photo est vérifiée lors de l'export du collage.`,
  enlarged: (percent: number) => `Agrandie à ${percent} %, elle paraîtra donc plus douce.`,
  sharp: `Assez de pixels pour cette taille.`,
  ppi: (ppi: number) => `${ppi} pixels par pouce.`,
  lowPpi: (ppi: number, dpi: number) => `${ppi} pixels par pouce, sous les ${dpi} DPI choisis : l'impression sera plus douce.`,
  lowSummary: (n: number) => plural(n, { one: `${n} fenêtre a moins de pixels que cette taille n'en demande. Choisissez une taille plus petite, ou exportez quand même : elle paraîtra plus douce.`, other: `${n} fenêtres ont moins de pixels que cette taille n'en demande. Choisissez une taille plus petite, ou exportez quand même : elles paraîtront plus douces.` }),
  exportAnyway: (n: number) => plural(n, { one: `Exporter quand même (${n} fenêtre plus douce)`, other: `Exporter quand même (${n} fenêtres plus douces)` }),
  rawNote: `Les fichiers RAW sont développés par InFlight à partir des données du capteur, comme dans l'éditeur ; les aperçus intégrés de l'appareil ne sont jamais utilisés. Les originaux HEIF ne sont pas encore pris en charge dans un collage.`,
  heif: (filename: string) => `${filename} est un fichier HEIF. Un collage ne peut pas encore vérifier ses pixels en pleine résolution, donc rien n'a été mis à sa place.`,
  embedded: (filename: string) => `${filename} n'a pas d'image développée à partir des données du capteur, et un aperçu intégré de l'appareil n'est jamais utilisé dans un collage.`,
  done: `Collage exporté. Vos originaux sont inchangés.`,
  doneSoft: (n: number) => plural(n, { one: `Collage exporté. ${n} fenêtre a été agrandie ou est sous la résolution d'impression, comme indiqué avant l'export. Vos originaux sont inchangés.`, other: `Collage exporté. ${n} fenêtres ont été agrandies ou sont sous la résolution d'impression, comme indiqué avant l'export. Vos originaux sont inchangés.` }),
};
