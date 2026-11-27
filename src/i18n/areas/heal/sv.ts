import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  title: "Ta bort fläckar",
  intro: "Täcker damm, en kvist eller skräp kring sittplatsen med pixlar som kopieras från närheten i samma foto. Inget hittas på och originalfilen ändras aldrig.",
  start: "Markera fläckar",
  stop: "Klar",
  placing: "Klicka eller tryck på varje fläck som ska täckas. Tryck på Escape när du är klar.",
  size: "Storlek",
  feather: "Mjukhet",
  method: "Metod",
  heal: "Laga: smälter in i omgivningen",
  clone: "Klona: exakt kopia",
  nextSource: "Kopiera från ett annat ställe",
  remove: "Ta bort fläck",
  removeAll: "Ta bort alla fläckar",
  show: "Visa fläck",
  hide: "Dölj fläck",
  spot: (n: number) => `Fläck ${n}`,
  hidden: "dold",
  count: (n: number) => plural(n, { one: `${n} fläck`, other: `${n} fläckar` }),
  empty: "Inga fläckar än.",
  added: "Fläcken är täckt. Dra den streckade cirkeln, eller välj Kopiera från ett annat ställe, för att byta källa.",
  full: (n: number) => `Det här fotot har redan ${n} fläckar, det högsta tillåtna.`,
  noSource: "Inget i närheten var tillräckligt likt att kopiera från. Prova en mindre storlek.",
  unreadable: "Fotot kunde inte läsas just nu, så ingen fläck lades till.",
  noOther: "Det finns inget annat ställe i närheten att kopiera från.",
  working: "Letar efter ett ställe att kopiera från…",
  historyStep: "Fläckborttagning",
  layer: "Lagade fläckar",
  select: (n: number) => `Fläck ${n}: välj`,
  source: (n: number) => `Källa för fläck ${n}: dra eller använd piltangenterna`,
};
