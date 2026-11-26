import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  menu: (n: number) => `Flet ${n} billeder til HDR`,
  menuHint: "Fletter en serie mørkere og lysere billeder til et nyt 16-bit billede, der bevarer højlys og skygger. Originalerne ændres ikke.",
  task: (n: number) => `Fletter ${n} billeder til HDR`,
  reading: "Læser billederne",
  aligning: "Retter billederne ind",
  merging: "Fletter eksponeringerne",
  saving: "Tilføjer HDR-billedet",
  done: (name: string, n: number) => `${name} er tilføjet, flettet af ${n} billeder. Dine originale billeder er uberørte.`,
  cancelled: "HDR-fletning stoppet. Intet blev tilføjet. Dine originale billeder er uberørte.",
  failed: "HDR-fletningen blev ikke færdig. Åbn Opgaver for at se årsagen. Dine originale billeder er uberørte.",
  tooFew: "Vælg mindst to billeder af samme motiv, taget mørkere og lysere, for at flette til HDR. Dine originale billeder er uberørte.",
  tooMany: (max: number) => `Vælg højst ${max} billeder ad gangen for at flette til HDR. Dine originale billeder er uberørte.`,
  sizeMismatch: "Billederne har forskellig størrelse, så de kan ikke rettes ind. Dine originale billeder er uberørte.",
  sameExposure: "Billederne ser ud til at have samme eksponering, så der er intet at flette. Vælg en serie taget mørkere og lysere. Dine originale billeder er uberørte.",
  unrelated: (n: number) => `Billede ${n} kan ikke rettes tydeligt nok ind efter de andre, så intet blev flettet i stedet for at gætte. Vælg billeder fra én serie. Dine originale billeder er uberørte.`,
  unsupported: (name: string) => `${name} kan ikke læses i fuld størrelse her, så intet blev flettet. Der blev ikke brugt et mindre billede i stedet. Dine originale billeder er uberørte.`,
  rawNotDeveloped: (name: string) => `${name} kunne ikke fremkaldes i 16 bit fra sensordata her, og kameraets lille indlejrede forhåndsvisning bruges ikke til HDR. Forbind originalen igen, og prøv igen. Dine originale billeder er uberørte.`,
  tooLarge: "Billederne er for store til at flette sikkert på denne enhed. Intet blev flettet. Dine originale billeder er uberørte.",
  ghostsRemoved: "Noget bevægede sig mellem billederne. Der bruger fletningen kun ét billede, så intet ses to gange.",
  highlightsClipped: "Noget højlys var for lyst selv i det mørkeste billede, så det forbliver hvidt.",
  mainThread: "Det kørte i forgrunden, fordi baggrundsarbejde ikke er tilgængeligt her, så appen kan have hakket undervejs.",
  infoTitle: "HDR-fletning",
  infoMadeFrom: (n: number) => plural(n, { one: `Lavet af ${n} billede:`, other: `Lavet af ${n} billeder:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} trin`,
  infoHow: "Hver del kommer fra de billeder, der var godt eksponeret der, rettet ind og vægtet efter eksponering, og derefter justeret med editorens Højlys og Skygger. Ingen pixels blev genereret.",
};
