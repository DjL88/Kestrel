import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  title: "Tallennetut näkymät",
  hint: "Tallennetaan vain tälle laitteelle. Näkymä muuttaa näytettäviä kuvia, ei koskaan itse kuvia.",
  none: "Ei vielä tallennettuja näkymiä. Valitse suodattimet ja tallenna ne tähän nimellä.",
  show: (name: string) => `Näytä ${name}`,
  remove: (name: string) => `Poista tallennettu näkymä ${name}`,
  nameLabel: "Nimi näille suodattimille",
  save: "Tallenna näkymä",
  saved: (name: string) => `Näkymä ${name} tallennettu.`,
  replaced: (name: string) => `Näkymä ${name} päivitetty.`,
  emptyName: "Kirjoita ensin näkymän nimi.",
  full: (max: number) => `Voit tallentaa enintään ${max} näkymää. Poista ensin yksi.`,
  notStored: "Laite ei tallentanut näkymää, joten se katoaa, kun InFlight suljetaan.",
  showing: (name: string) => `Näytetään tallennettu näkymä ${name}`,
  noneAhead: "Näytetyissä kuvissa ei ole tämän jälkeen enää läpikäytäviä.",
  noneBehind: "Näytetyissä kuvissa ei ole ennen tätä läpikäytäviä.",
};
