import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  title: "Vistuð sýn",
  hint: "Geymt aðeins á þessu tæki. Sýn breytir því hvaða myndir eru sýndar, aldrei myndunum sjálfum.",
  none: "Engin vistuð sýn enn. Veldu síur og vistaðu þær hér með nafni.",
  show: (name: string) => `Sýna ${name}`,
  remove: (name: string) => `Eyða vistuðu sýninni ${name}`,
  nameLabel: "Nafn á þessum síum",
  save: "Vista sýn",
  saved: (name: string) => `Sýnin ${name} var vistuð.`,
  replaced: (name: string) => `Sýnin ${name} var uppfærð.`,
  emptyName: "Skrifaðu fyrst nafn á sýnina.",
  full: (max: number) => `Þú getur geymt allt að ${max} sýnir. Eyddu einni fyrst.`,
  notStored: "Tækið geymdi ekki sýnina, svo hún hverfur þegar InFlight lokast.",
  showing: (name: string) => `Sýnir vistuðu sýnina ${name}`,
  noneAhead: "Engar fleiri myndir til að fara yfir á eftir þessari meðal þeirra sem sýndar eru.",
  noneBehind: "Engar myndir til að fara yfir á undan þessari meðal þeirra sem sýndar eru.",
};
