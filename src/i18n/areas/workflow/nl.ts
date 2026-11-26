import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  title: "Opgeslagen weergaven",
  hint: "Alleen op dit apparaat bewaard. Een weergave verandert welke foto's worden getoond, nooit de foto's zelf.",
  none: "Nog geen opgeslagen weergaven. Kies filters en sla ze hier op met een naam.",
  show: (name: string) => `${name} tonen`,
  remove: (name: string) => `Opgeslagen weergave ${name} verwijderen`,
  nameLabel: "Naam voor deze filters",
  save: "Weergave opslaan",
  saved: (name: string) => `Weergave ${name} opgeslagen.`,
  replaced: (name: string) => `Weergave ${name} bijgewerkt.`,
  emptyName: "Typ eerst een naam voor de weergave.",
  full: (max: number) => `U kunt tot ${max} weergaven bewaren. Verwijder er eerst een.`,
  notStored: "Dit apparaat heeft de weergave niet bewaard; die is weg als InFlight sluit.",
  showing: (name: string) => `Opgeslagen weergave: ${name}`,
  noneAhead: "Na deze foto zijn er bij de getoonde foto's geen meer om te beoordelen.",
  noneBehind: "Vóór deze foto zijn er bij de getoonde foto's geen om te beoordelen.",
};
