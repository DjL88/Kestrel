import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  paint: `Schilderen`,
  erase: `Wissen`,
  mode: `Penseelmodus`,
  size: `Penseelgrootte`,
  stop: `Stoppen met schilderen`,
  layer: (name: string) => `Penseel op ${name}`,
  help: `Sleep over de foto om te schilderen. Houd Alt ingedrukt om even te wissen. Druk op [ of ] om de grootte te wijzigen. Met het toetsenbord verplaatsen de pijltjestoetsen het penseel en schildert de spatiebalk.`,
  painting: (name: string) => `U schildert op ${name}. De aanpassingen ervan gelden waar u schildert.`,
  erasing: (name: string) => `U wist uit ${name}. De aanpassingen ervan stoppen waar u wist.`,
  added: `Penseelmasker toegevoegd. Sleep over de foto om te schilderen waar de aanpassingen moeten gelden.`,
  pickMask: `Open hieronder in de lijst een penseel-, onderwerp- of achtergrondmasker en schilder dan op de foto om het uit te breiden of te wissen.`,
  refine: `Penseel en gum verfijnen ook een onderwerp- of achtergrondmasker: open het in de lijst, schilder om toe te voegen of wis om weg te halen.`,
  full: (n: number) => `Dit masker heeft al ${n} penseelstreken, het maximum. Voeg nog een penseelmasker toe om verder te schilderen.`,
  strokes: (n: number) => plural(n, { one: `${n} penseelstreek`, other: `${n} penseelstreken` }),
  unavailable: `Schilderen is een voorbeeld. Zet Maskerpenseel aan bij Voorbeeldfuncties om het te gebruiken.`,
};
