import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  title: "Vlekken verwijderen",
  intro: "Bedekt stof, een takje of een rommelige zitplaats met pixels die vlakbij uit dezelfde foto worden gekopieerd. Er wordt niets verzonnen en het originele bestand wordt nooit gewijzigd.",
  start: "Vlekken plaatsen",
  stop: "Klaar",
  placing: "Klik of tik op elke vlek die u wilt bedekken. Druk op Escape als u klaar bent.",
  size: "Grootte",
  feather: "Zachtheid",
  method: "Methode",
  heal: "Herstellen: laten opgaan in de omgeving",
  clone: "Klonen: exacte kopie",
  nextSource: "Ergens anders vandaan kopiëren",
  remove: "Vlek verwijderen",
  removeAll: "Alle vlekken verwijderen",
  show: "Vlek tonen",
  hide: "Vlek verbergen",
  spot: (n: number) => `Vlek ${n}`,
  hidden: "verborgen",
  count: (n: number) => plural(n, { one: `${n} vlek`, other: `${n} vlekken` }),
  empty: "Nog geen vlekken.",
  added: "Vlek bedekt. Sleep de gestippelde cirkel, of kies Ergens anders vandaan kopiëren, om de bron te wijzigen.",
  full: (n: number) => `Deze foto heeft al ${n} vlekken, het maximum.`,
  noSource: "Er was in de buurt niets dat genoeg leek om te kopiëren. Probeer een kleinere grootte.",
  unreadable: "De foto kon nu niet worden gelezen, dus er is geen vlek toegevoegd.",
  noOther: "Er is geen andere plek in de buurt om van te kopiëren.",
  working: "Een plek zoeken om van te kopiëren…",
  historyStep: "Vlekken herstellen",
  layer: "Herstelde vlekken",
  select: (n: number) => `Vlek ${n}: selecteren`,
  source: (n: number) => `Bron van vlek ${n}: slepen of de pijltoetsen gebruiken`,
};
