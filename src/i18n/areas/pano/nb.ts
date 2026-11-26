import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  menu: (n: number) => `Sett sammen ${n} bilder til et panorama`,
  menuHint: "Setter sammen overlappende bilder til ett nytt bredt bilde, beskåret til ekte piksler. Originalene endres ikke.",
  task: (n: number) => `Setter sammen et panorama av ${n} bilder`,
  reading: "Leser bildene",
  matching: "Finner hvor bildene overlapper",
  placing: "Plasserer bildene",
  blending: "Blander skjøtene",
  saving: "Legger til panoramaet",
  done: (name: string, n: number) => `${name} er lagt til, satt sammen av ${n} bilder. De originale bildene dine er urørte.`,
  cropNote: (percent: number) => `Beskåret til de ${percent} % av det sammensatte området som ekte piksler dekker. Ingenting ble fylt inn.`,
  cancelled: "Sammensettingen ble stoppet. Ingenting ble lagt til. De originale bildene dine er urørte.",
  failed: "Panoramaet ble ikke ferdig. Åpne Oppgaver for å se årsaken. De originale bildene dine er urørte.",
  tooFew: "Velg minst to bilder som overlapper. De originale bildene dine er urørte.",
  tooMany: (max: number) => `Velg høyst ${max} bilder om gangen. De originale bildene dine er urørte.`,
  sizeMismatch: "Bildene har ulik størrelse, så de ble ikke satt sammen. De originale bildene dine er urørte.",
  tooFlat: (n: number) => `Bilde ${n} har for lite detaljer til å rettes inn, så ingenting ble satt sammen i stedet for å gjette. De originale bildene dine er urørte.`,
  unrelated: (n: number) => `Bilde ${n} overlapper ikke det forrige nok til å rette dem inn, så ingenting ble satt sammen. Velg bildene i den rekkefølgen du tok dem, hvert med omtrent en tredjedel overlapp. De originale bildene dine er urørte.`,
  ambiguous: (n: number) => `Det er uklart hvor bilde ${n} møter det forrige. Mønsteret gjentar seg, eller kameraet helte for mye, så ingenting ble satt sammen i stedet for å gjette. De originale bildene dine er urørte.`,
  vertical: "Bildene går opp og ned i stedet for til siden. Loddrette panoramaer støttes ikke ennå, så ingenting ble satt sammen. De originale bildene dine er urørte.",
  tooLarge: "Panoramaet ville blitt for stort til å lages trygt på denne enheten, og det gjøres ikke mindre uten å spørre. Velg færre bilder. De originale bildene dine er urørte.",
  noCoverage: "Bildene etterlater ikke noe rektangel dekket av ekte piksler, så ingenting ble satt sammen i stedet for å fylle hull. De originale bildene dine er urørte.",
  unsupported: (name: string) => `${name} kan ikke leses i full størrelse her, så ingenting ble satt sammen. Det ble ikke brukt et mindre bilde i stedet. De originale bildene dine er urørte.`,
  rawNotDeveloped: (name: string) => `${name} har ennå ingen fremkalling i full størrelse fra sensordataene, og kameraets lille innebygde forhåndsvisning brukes ikke til panoramaer. Lag fremkallingen i full størrelse først. De originale bildene dine er urørte.`,
  exposureDiffers: "Bildene ble tatt med ganske ulik lysstyrke. De ble jevnet ut, men sjekk himmelen for striper.",
  seamsVisible: "Noen skjøter kan synes: noe beveget seg mellom bildene, eller kameraet ble flyttet i stedet for dreid.",
  focalEstimated: "Objektivets brennvidde var ikke lagret, så den ble regnet ut fra bildene.",
  mainThread: "Det kjørte i forgrunnen fordi bakgrunnsarbeid ikke er tilgjengelig her, så appen kan ha hakket underveis.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Satt sammen av ${n} bilde:`, other: `Satt sammen av ${n} bilder:` }),
  infoHow: "Lagt på en sylinder, skjøter mykt blandet og beskåret til ekte piksler. Ingen piksler ble generert.",
};
