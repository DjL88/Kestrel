import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  menu: (n: number) => `Saml ${n} billeder til et panorama`,
  menuHint: "Samler overlappende billeder til ét nyt bredt billede, beskåret til rigtige pixels. Originalerne ændres ikke.",
  task: (n: number) => `Samler et panorama af ${n} billeder`,
  reading: "Læser billederne",
  matching: "Finder, hvor billederne overlapper",
  placing: "Placerer billederne",
  blending: "Blender sømmene",
  saving: "Tilføjer panoramaet",
  done: (name: string, n: number) => `${name} er tilføjet, samlet af ${n} billeder. Dine originale billeder er uberørte.`,
  cropNote: (percent: number) => `Beskåret til de ${percent} % af det samlede område, som rigtige pixels dækker. Intet blev fyldt ud.`,
  cancelled: "Samlingen blev stoppet. Intet blev tilføjet. Dine originale billeder er uberørte.",
  failed: "Panoramaet blev ikke færdigt. Åbn Opgaver for at se årsagen. Dine originale billeder er uberørte.",
  tooFew: "Vælg mindst to billeder, der overlapper. Dine originale billeder er uberørte.",
  tooMany: (max: number) => `Vælg højst ${max} billeder ad gangen. Dine originale billeder er uberørte.`,
  sizeMismatch: "Billederne har forskellig størrelse, så de blev ikke samlet. Dine originale billeder er uberørte.",
  tooFlat: (n: number) => `Billede ${n} har for få detaljer til at blive rettet ind, så intet blev samlet i stedet for at gætte. Dine originale billeder er uberørte.`,
  unrelated: (n: number) => `Billede ${n} overlapper ikke det forrige nok til at rette dem ind, så intet blev samlet. Vælg billederne i den rækkefølge, du tog dem, hvert med cirka en tredjedel overlap. Dine originale billeder er uberørte.`,
  ambiguous: (n: number) => `Det er uklart, hvor billede ${n} møder det forrige. Mønsteret gentager sig, eller kameraet hældte for meget, så intet blev samlet i stedet for at gætte. Dine originale billeder er uberørte.`,
  vertical: "Billederne går op og ned i stedet for til siden. Lodrette panoramaer understøttes ikke endnu, så intet blev samlet. Dine originale billeder er uberørte.",
  tooLarge: "Panoramaet ville blive for stort til at lave sikkert på denne enhed, og det gøres ikke mindre uden at spørge. Vælg færre billeder. Dine originale billeder er uberørte.",
  noCoverage: "Billederne efterlader intet rektangel dækket af rigtige pixels, så intet blev samlet i stedet for at fylde huller. Dine originale billeder er uberørte.",
  unsupported: (name: string) => `${name} kan ikke læses i fuld størrelse her, så intet blev samlet. Der blev ikke brugt et mindre billede i stedet. Dine originale billeder er uberørte.`,
  rawNotDeveloped: (name: string) => `${name} har endnu ingen fremkaldelse i fuld størrelse fra sensordata, og kameraets lille indlejrede forhåndsvisning bruges ikke til panoramaer. Lav først fremkaldelsen i fuld størrelse. Dine originale billeder er uberørte.`,
  exposureDiffers: "Billederne blev taget med ret forskellig lysstyrke. De blev udjævnet, men tjek himlen for striber.",
  seamsVisible: "Nogle sømme kan ses: noget bevægede sig mellem billederne, eller kameraet flyttede sig i stedet for at dreje.",
  focalEstimated: "Objektivets brændvidde var ikke gemt, så den blev beregnet ud fra billederne.",
  mainThread: "Det kørte i forgrunden, fordi baggrundsarbejde ikke er tilgængeligt her, så appen kan have hakket undervejs.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Samlet af ${n} billede:`, other: `Samlet af ${n} billeder:` }),
  infoHow: "Lagt på en cylinder, sømme blendet blødt og beskåret til rigtige pixels. Ingen pixels blev genereret.",
};
