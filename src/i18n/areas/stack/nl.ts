import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  menu: (n: number) => `Focus stacken van ${n} foto's`,
  menuHint: "Voegt de scherpste delen van elke foto samen tot een nieuwe foto. De originelen worden niet gewijzigd.",
  task: (n: number) => `Focus stacken van ${n} foto's`,
  reading: "Foto's lezen",
  aligning: "Foto's uitlijnen",
  blending: "Scherpste delen samenvoegen",
  saving: "Gestapelde foto toevoegen",
  done: (name: string, n: number) => `${name} toegevoegd, gestapeld uit ${n} foto's. Uw originele foto's blijven onaangeroerd.`,
  cancelled: "Focus stacken gestopt. Er is niets toegevoegd. Uw originele foto's blijven onaangeroerd.",
  failed: "Focus stacken is niet voltooid. Open Taken voor de reden. Uw originele foto's blijven onaangeroerd.",
  tooFew: "Kies minstens twee foto's van hetzelfde tafereel. Uw originele foto's blijven onaangeroerd.",
  tooMany: (max: number) => `Kies maximaal ${max} foto's tegelijk. Uw originele foto's blijven onaangeroerd.`,
  sizeMismatch: "Deze foto's hebben verschillende afmetingen en kunnen daarom niet worden uitgelijnd. Uw originele foto's blijven onaangeroerd.",
  unrelated: (n: number) => `Foto ${n} lijkt niet hetzelfde tafereel te tonen als zijn buur, dus er is niets gestapeld. Kies beelden uit één reeks. Uw originele foto's blijven onaangeroerd.`,
  ambiguous: (n: number) => `Het is niet duidelijk hoe foto ${n} op zijn buur aansluit. Het patroon herhaalt zich of er is te veel beweging, dus er is niets gestapeld in plaats van te gokken. Uw originele foto's blijven onaangeroerd.`,
  tooFlat: (n: number) => `Foto ${n} heeft te weinig detail om uit te lijnen, dus er is niets gestapeld in plaats van te gokken. Uw originele foto's blijven onaangeroerd.`,
  unsupported: (name: string) => `${name} kan hier niet op volle grootte worden gelezen, dus er is niets gestapeld. Er is geen kleinere afbeelding gebruikt. Uw originele foto's blijven onaangeroerd.`,
  rawNotDeveloped: (name: string) => `${name} heeft nog geen ontwikkeling op volle grootte uit de sensordata, en het kleine ingesloten voorbeeld van de camera wordt niet gebruikt voor stacken. Maak eerst de ontwikkeling op volle grootte. Uw originele foto's blijven onaangeroerd.`,
  tooLarge: "Deze foto's zijn te groot om veilig te stacken op dit apparaat. Er is niets gestapeld. Uw originele foto's blijven onaangeroerd.",
  equallySharp: "Deze foto's lijken overal even scherp, dus de stapel lijkt mogelijk veel op de originelen.",
  frameUnused: (n: number) => `Foto ${n} heeft bijna niets aan de stapel toegevoegd.`,
  oneFrameDominates: "Eén foto leverde bijna al het detail. Controleer of de foto's op verschillende scherpstelafstanden zijn gemaakt.",
  localFallback: (n: number) => `Foto ${n} is alleen als geheel uitgelijnd: er was te weinig overeenkomend detail voor fijnere uitlijning.`,
  infoTitle: "Focus stack",
  infoMadeFrom: (n: number) => plural(n, { one: `Gemaakt van ${n} foto:`, other: `Gemaakt van ${n} foto's:` }),
  infoHow: "Elk deel komt uit de scherpste foto op die plek, zacht overgevloeid. Er zijn geen pixels gegenereerd.",
};
