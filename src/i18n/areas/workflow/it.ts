import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  title: "Viste salvate",
  hint: "Conservate solo su questo dispositivo. Una vista cambia quali foto vengono mostrate, mai le foto stesse.",
  none: "Nessuna vista salvata. Scelga i filtri e li salvi qui con un nome.",
  show: (name: string) => `Mostra ${name}`,
  remove: (name: string) => `Elimina la vista salvata ${name}`,
  nameLabel: "Nome per questi filtri",
  save: "Salva vista",
  saved: (name: string) => `Vista ${name} salvata.`,
  replaced: (name: string) => `Vista ${name} aggiornata.`,
  emptyName: "Scriva prima un nome per la vista.",
  full: (max: number) => `Può conservare fino a ${max} viste. Ne elimini prima una.`,
  notStored: "Questo dispositivo non ha conservato la vista: sparirà alla chiusura di InFlight.",
  showing: (name: string) => `Vista salvata mostrata: ${name}`,
  noneAhead: "Non ci sono altre foto da rivedere dopo questa tra quelle mostrate.",
  noneBehind: "Non ci sono foto da rivedere prima di questa tra quelle mostrate.",
};
