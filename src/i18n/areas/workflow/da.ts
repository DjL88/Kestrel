import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  title: "Gemte visninger",
  hint: "Gemmes kun på denne enhed. En visning ændrer, hvilke fotos der vises, aldrig selve fotoene.",
  none: "Ingen gemte visninger endnu. Vælg filtre, og gem dem her med et navn.",
  show: (name: string) => `Vis ${name}`,
  remove: (name: string) => `Slet den gemte visning ${name}`,
  nameLabel: "Navn til disse filtre",
  save: "Gem visning",
  saved: (name: string) => `Visningen ${name} er gemt.`,
  replaced: (name: string) => `Visningen ${name} er opdateret.`,
  emptyName: "Skriv først et navn til visningen.",
  full: (max: number) => `Du kan gemme op til ${max} visninger. Slet en først.`,
  notStored: "Enheden gemte ikke visningen, så den forsvinder, når InFlight lukker.",
  showing: (name: string) => `Viser den gemte visning ${name}`,
  noneAhead: "Ingen flere fotos at gennemgå efter dette blandt de viste.",
  noneBehind: "Ingen fotos at gennemgå før dette blandt de viste.",
};
