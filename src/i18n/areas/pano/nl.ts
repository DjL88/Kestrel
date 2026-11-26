import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  menu: (n: number) => `${n} foto's samenvoegen tot een panorama`,
  menuHint: "Voegt overlappende foto's samen tot één nieuwe brede foto, bijgesneden tot echte pixels. De originelen worden niet gewijzigd.",
  task: (n: number) => `Panorama samenvoegen uit ${n} foto's`,
  reading: "Foto's lezen",
  matching: "Zoeken waar de foto's overlappen",
  placing: "Foto's plaatsen",
  blending: "Naden laten overlopen",
  saving: "Panorama toevoegen",
  done: (name: string, n: number) => `${name} toegevoegd, samengevoegd uit ${n} foto's. Uw originele foto's blijven onaangeroerd.`,
  cropNote: (percent: number) => `Bijgesneden tot de ${percent}% van het samengevoegde vlak dat echte pixels bedekken. Er is niets opgevuld.`,
  cancelled: "Samenvoegen gestopt. Er is niets toegevoegd. Uw originele foto's blijven onaangeroerd.",
  failed: "Het panorama is niet afgemaakt. Open Taken voor de reden. Uw originele foto's blijven onaangeroerd.",
  tooFew: "Kies minstens twee overlappende foto's. Uw originele foto's blijven onaangeroerd.",
  tooMany: (max: number) => `Kies maximaal ${max} foto's tegelijk. Uw originele foto's blijven onaangeroerd.`,
  sizeMismatch: "Deze foto's hebben verschillende afmetingen, dus ze zijn niet samengevoegd. Uw originele foto's blijven onaangeroerd.",
  tooFlat: (n: number) => `Foto ${n} heeft te weinig detail om uit te lijnen, dus er is niets samengevoegd in plaats van te gokken. Uw originele foto's blijven onaangeroerd.`,
  unrelated: (n: number) => `Foto ${n} overlapt de vorige foto niet genoeg om ze uit te lijnen, dus er is niets samengevoegd. Kies de foto's in opnamevolgorde, elk ongeveer een derde over de volgende. Uw originele foto's blijven onaangeroerd.`,
  ambiguous: (n: number) => `Het is niet duidelijk waar foto ${n} aansluit op de vorige. Het patroon herhaalt zich, of de camera helde te veel, dus er is niets samengevoegd in plaats van te gokken. Uw originele foto's blijven onaangeroerd.`,
  vertical: "Deze foto's lopen van boven naar beneden in plaats van zijwaarts. Verticale panorama's worden nog niet ondersteund, dus er is niets samengevoegd. Uw originele foto's blijven onaangeroerd.",
  tooLarge: "Dit panorama zou te groot zijn om veilig op dit apparaat te maken, en het wordt niet zonder vragen verkleind. Kies minder foto's. Uw originele foto's blijven onaangeroerd.",
  noCoverage: "De foto's laten geen rechthoek over die echte pixels bedekken, dus er is niets samengevoegd in plaats van gaten op te vullen. Uw originele foto's blijven onaangeroerd.",
  unsupported: (name: string) => `${name} kan hier niet op volle grootte worden gelezen, dus er is niets samengevoegd. Er is geen kleinere afbeelding gebruikt. Uw originele foto's blijven onaangeroerd.`,
  rawNotDeveloped: (name: string) => `${name} heeft nog geen ontwikkeling op volle grootte uit de sensordata, en het kleine ingesloten voorbeeld van de camera wordt niet gebruikt voor panorama's. Maak eerst de ontwikkeling op volle grootte. Uw originele foto's blijven onaangeroerd.`,
  exposureDiffers: "De foto's zijn met behoorlijk verschillende helderheid gemaakt. Ze zijn gelijkgetrokken, maar controleer de lucht op banen.",
  seamsVisible: "Sommige naden kunnen zichtbaar zijn: er bewoog iets tussen de foto's, of de camera verschoof in plaats van te draaien.",
  focalEstimated: "De brandpuntsafstand van het objectief was niet vastgelegd, dus die is uit de foto's afgeleid.",
  mainThread: "Het draaide op de voorgrond omdat werk op de achtergrond hier niet beschikbaar is, dus de app kan even hebben gehaperd.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Samengevoegd uit ${n} foto:`, other: `Samengevoegd uit ${n} foto's:` }),
  infoHow: "Op een cilinder geplaatst, naden zacht laten overlopen en bijgesneden tot echte pixels. Er zijn geen pixels gegenereerd.",
};
