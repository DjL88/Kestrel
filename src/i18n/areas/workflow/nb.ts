import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  title: "Lagrede visninger",
  hint: "Lagres bare på denne enheten. En visning endrer hvilke bilder som vises, aldri selve bildene.",
  none: "Ingen lagrede visninger ennå. Velg filtre og lagre dem her med et navn.",
  show: (name: string) => `Vis ${name}`,
  remove: (name: string) => `Slett den lagrede visningen ${name}`,
  nameLabel: "Navn på disse filtrene",
  save: "Lagre visning",
  saved: (name: string) => `Visningen ${name} er lagret.`,
  replaced: (name: string) => `Visningen ${name} er oppdatert.`,
  emptyName: "Skriv først et navn på visningen.",
  full: (max: number) => `Du kan lagre opptil ${max} visninger. Slett en først.`,
  notStored: "Enheten lagret ikke visningen, så den forsvinner når InFlight lukkes.",
  showing: (name: string) => `Viser den lagrede visningen ${name}`,
  noneAhead: "Ingen flere bilder å gå gjennom etter dette blant de som vises.",
  noneBehind: "Ingen bilder å gå gjennom før dette blant de som vises.",
};
