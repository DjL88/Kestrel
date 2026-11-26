import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  title: "Gespeicherte Ansichten",
  hint: "Nur auf diesem Gerät gespeichert. Eine Ansicht ändert, welche Fotos gezeigt werden, nie die Fotos selbst.",
  none: "Noch keine gespeicherten Ansichten. Wählen Sie Filter und speichern Sie sie hier mit einem Namen.",
  show: (name: string) => `${name} anzeigen`,
  remove: (name: string) => `Gespeicherte Ansicht ${name} löschen`,
  nameLabel: "Name für diese Filter",
  save: "Ansicht speichern",
  saved: (name: string) => `Ansicht ${name} gespeichert.`,
  replaced: (name: string) => `Ansicht ${name} aktualisiert.`,
  emptyName: "Geben Sie zuerst einen Namen für die Ansicht ein.",
  full: (max: number) => `Sie können bis zu ${max} Ansichten speichern. Löschen Sie zuerst eine.`,
  notStored: "Dieses Gerät hat die Ansicht nicht gespeichert. Sie ist weg, wenn InFlight geschlossen wird.",
  showing: (name: string) => `Gespeicherte Ansicht: ${name}`,
  noneAhead: "Nach diesem Foto gibt es unter den gezeigten Fotos keine weiteren zu prüfen.",
  noneBehind: "Vor diesem Foto gibt es unter den gezeigten Fotos keine zu prüfen.",
};
