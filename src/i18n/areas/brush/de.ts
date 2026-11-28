import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  paint: `Malen`,
  erase: `Radieren`,
  mode: `Pinselmodus`,
  size: `Pinselgröße`,
  stop: `Malen beenden`,
  layer: (name: string) => `Pinsel auf ${name}`,
  help: `Ziehen Sie auf dem Foto, um zu malen. Halten Sie Alt gedrückt, um kurz zu radieren. Mit [ oder ] ändern Sie die Größe. Per Tastatur bewegen die Pfeiltasten den Pinsel, und die Leertaste malt.`,
  painting: (name: string) => `Sie malen auf ${name}. Seine Einstellungen wirken dort, wo Sie malen.`,
  erasing: (name: string) => `Sie radieren auf ${name}. Seine Einstellungen enden dort, wo Sie radieren.`,
  added: `Pinselmaske hinzugefügt. Ziehen Sie auf dem Foto, um zu malen, wo ihre Einstellungen wirken sollen.`,
  pickMask: `Öffnen Sie unten in der Liste eine Pinsel-, Motiv- oder Hintergrundmaske und malen Sie dann auf dem Foto, um sie zu erweitern oder zu radieren.`,
  refine: `Pinsel und Radierer verfeinern auch eine Motiv- oder Hintergrundmaske: Öffnen Sie sie in der Liste, malen Sie zum Hinzufügen oder radieren Sie zum Entfernen.`,
  full: (n: number) => `Diese Maske hat bereits ${n} Pinselstriche, das Maximum. Fügen Sie eine weitere Pinselmaske hinzu, um weiterzumalen.`,
  strokes: (n: number) => plural(n, { one: `${n} Pinselstrich`, other: `${n} Pinselstriche` }),
  unavailable: `Malen ist eine Vorschau. Schalten Sie Maskenpinsel unter Vorschau-Funktionen ein, um es zu nutzen.`,
};
