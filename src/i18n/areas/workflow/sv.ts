import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  title: "Sparade vyer",
  hint: "Sparas bara på den här enheten. En vy ändrar vilka foton som visas, aldrig själva fotona.",
  none: "Inga sparade vyer än. Välj filter och spara dem här med ett namn.",
  show: (name: string) => `Visa ${name}`,
  remove: (name: string) => `Ta bort den sparade vyn ${name}`,
  nameLabel: "Namn på de här filtren",
  save: "Spara vy",
  saved: (name: string) => `Vyn ${name} har sparats.`,
  replaced: (name: string) => `Vyn ${name} har uppdaterats.`,
  emptyName: "Skriv först ett namn på vyn.",
  full: (max: number) => `Du kan spara upp till ${max} vyer. Ta bort en först.`,
  notStored: "Enheten sparade inte vyn, så den försvinner när InFlight stängs.",
  showing: (name: string) => `Visar den sparade vyn ${name}`,
  noneAhead: "Inga fler foton att granska efter det här bland de som visas.",
  noneBehind: "Inga foton att granska före det här bland de som visas.",
};
