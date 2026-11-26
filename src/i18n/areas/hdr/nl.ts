import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  menu: (n: number) => `${n} foto's samenvoegen tot HDR`,
  menuHint: "Voegt een reeks donkerdere en lichtere foto's samen tot een nieuwe 16-bits foto die hoge lichten en schaduwen behoudt. De originelen worden niet gewijzigd.",
  task: (n: number) => `${n} foto's samenvoegen tot HDR`,
  reading: "Foto's lezen",
  aligning: "Foto's uitlijnen",
  merging: "Belichtingen samenvoegen",
  saving: "HDR-foto toevoegen",
  done: (name: string, n: number) => `${name} toegevoegd, samengevoegd uit ${n} foto's. Uw originele foto's blijven onaangeroerd.`,
  cancelled: "HDR samenvoegen gestopt. Er is niets toegevoegd. Uw originele foto's blijven onaangeroerd.",
  failed: "HDR samenvoegen is niet voltooid. Open Taken voor de reden. Uw originele foto's blijven onaangeroerd.",
  tooFew: "Kies minstens twee foto's van dezelfde scène, donkerder en lichter genomen, om samen te voegen tot HDR. Uw originele foto's blijven onaangeroerd.",
  tooMany: (max: number) => `Kies maximaal ${max} foto's tegelijk om samen te voegen tot HDR. Uw originele foto's blijven onaangeroerd.`,
  sizeMismatch: "Deze foto's hebben verschillende afmetingen en kunnen daarom niet worden uitgelijnd. Uw originele foto's blijven onaangeroerd.",
  sameExposure: "Deze foto's lijken dezelfde belichting te hebben, dus er valt niets samen te voegen. Kies een reeks die donkerder en lichter is genomen. Uw originele foto's blijven onaangeroerd.",
  unrelated: (n: number) => `Foto ${n} lijnt niet duidelijk genoeg uit met de andere, dus er is niets samengevoegd in plaats van te gokken. Kies beelden uit één reeks. Uw originele foto's blijven onaangeroerd.`,
  unsupported: (name: string) => `${name} kan hier niet op volle grootte worden gelezen, dus er is niets samengevoegd. Er is geen kleinere afbeelding gebruikt. Uw originele foto's blijven onaangeroerd.`,
  rawNotDeveloped: (name: string) => `${name} kon hier niet op 16 bits uit de sensorgegevens worden ontwikkeld, en de kleine ingebouwde voorvertoning van de camera wordt niet gebruikt voor HDR. Koppel het origineel opnieuw en probeer het nog eens. Uw originele foto's blijven onaangeroerd.`,
  tooLarge: "Deze foto's zijn te groot om veilig samen te voegen op dit apparaat. Er is niets samengevoegd. Uw originele foto's blijven onaangeroerd.",
  ghostsRemoved: "Er bewoog iets tussen de foto's. Daar gebruikt het samenvoegen maar één foto, zodat niets dubbel verschijnt.",
  highlightsClipped: "Sommige hoge lichten waren zelfs in de donkerste foto te helder, dus die blijven wit.",
  mainThread: "Het draaide op de voorgrond omdat werk op de achtergrond hier niet beschikbaar is, dus de app kan even hebben gehaperd.",
  infoTitle: "HDR samenvoegen",
  infoMadeFrom: (n: number) => plural(n, { one: `Gemaakt van ${n} foto:`, other: `Gemaakt van ${n} foto's:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stops`,
  infoHow: "Elk deel komt uit de foto's die daar goed belicht waren, uitgelijnd en gewogen naar belichting, en daarna afgesteld met Hoge lichten en Schaduwen van de editor. Er zijn geen pixels gegenereerd.",
  whatIs: "HDR betekent hoog dynamisch bereik, niet hoge definitie. Het combineert meerdere belichtingen van dezelfde scène, zodat heldere luchten en donkere schaduwen allebei hun detail houden.",
  bracketTitle: "Belichtingsreeks",
  bracketFound: (n: number, stops: string) => `${n} foto's, vlak na elkaar met verschillende belichting genomen (${stops} stops).`,
  bracketFromCamera: "Uw camera heeft deze foto's als belichtingsreeks gemarkeerd.",
  bracketFromExposures: "Gevonden aan de hand van sluitertijd, diafragma en ISO.",
};
