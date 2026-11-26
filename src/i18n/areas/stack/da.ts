import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fokusstak ${n} billeder`,
  menuHint: "Samler de skarpeste dele af hvert billede i et nyt billede. Originalerne ændres ikke.",
  task: (n: number) => `Fokusstakker ${n} billeder`,
  reading: "Læser billederne",
  aligning: "Retter billederne ind",
  blending: "Samler de skarpeste dele",
  saving: "Tilføjer det stakkede billede",
  done: (name: string, n: number) => `${name} er tilføjet, stakket af ${n} billeder. Dine originale billeder er uberørte.`,
  cancelled: "Fokusstakning stoppet. Intet blev tilføjet. Dine originale billeder er uberørte.",
  failed: "Fokusstakningen blev ikke færdig. Åbn Opgaver for at se årsagen. Dine originale billeder er uberørte.",
  tooFew: "Vælg mindst to billeder af samme motiv. Dine originale billeder er uberørte.",
  tooMany: (max: number) => `Vælg højst ${max} billeder ad gangen. Dine originale billeder er uberørte.`,
  sizeMismatch: "Billederne har forskellig størrelse, så de kan ikke rettes ind. Dine originale billeder er uberørte.",
  unrelated: (n: number) => `Billede ${n} ligner ikke samme motiv som naboen, så intet blev stakket. Vælg billeder fra én serie. Dine originale billeder er uberørte.`,
  ambiguous: (n: number) => `Det er uklart, hvordan billede ${n} passer med naboen (mønsteret gentager sig, eller det flyttede sig for meget), så intet blev stakket i stedet for at gætte. Dine originale billeder er uberørte.`,
  tooFlat: (n: number) => `Billede ${n} har for få detaljer til at blive rettet ind, så intet blev stakket i stedet for at gætte. Dine originale billeder er uberørte.`,
  unsupported: (name: string) => `${name} kan ikke læses i fuld størrelse her, så intet blev stakket. Der blev ikke brugt et mindre billede i stedet. Dine originale billeder er uberørte.`,
  rawNotDeveloped: (name: string) => `${name} har endnu ingen fremkaldelse i fuld størrelse fra sensordata, og kameraets lille indlejrede forhåndsvisning bruges ikke. Lav først fremkaldelsen i fuld størrelse. Dine originale billeder er uberørte.`,
  tooLarge: "Billederne er for store til at stakke sikkert på denne enhed. Intet blev stakket. Dine originale billeder er uberørte.",
  equallySharp: "Billederne ser lige skarpe ud overalt, så stakken ligner måske originalerne meget.",
  frameUnused: (n: number) => `Billede ${n} bidrog næsten ikke med noget.`,
  oneFrameDominates: "Ét billede leverede næsten alle detaljer. Tjek, at billederne er taget med forskellig fokusafstand.",
  localFallback: (n: number) => `Billede ${n} blev kun rettet ind som helhed: for få matchende detaljer til finere indretning.`,
  mainThread: "Det kørte i forgrunden, fordi baggrundsarbejde ikke er tilgængeligt her, så appen kan have hakket undervejs.",
  infoTitle: "Fokusstak",
  infoMadeFrom: (n: number) => plural(n, { one: `Lavet af ${n} billede:`, other: `Lavet af ${n} billeder:` }),
  infoHow: "Hver del kommer fra det skarpeste billede netop dér, blødt sammenblandet. Ingen pixels blev genereret.",
};
