import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  whereTaken: "Hvor er disse billeder taget?",
  whereTakenHint: "Artsnavne sammenlignes med de dyr, der findes der. Det gælder kun for dette projekt.",
  home: (region: string) => `Hjemregion (${region})`,
  worldwide: "Hele verden",
  regionsHeading: "Regioner",
  countriesHeading: "Lande",
  homeSetting: "Hjemregion",
  homeSettingHint: "Hvor du normalt fotograferer. Projekter sammenligner artsnavne med denne region, medmindre du vælger et andet sted.",
  matchedIn: (area: string) => `Artsliste brugt: ${area}`,
  suggestion: (area: string) => `Billedernes steder peger på: ${area}.`,
  suggestionPrivacy: "Læst fra filerne på denne enhed. Stederne sendes ingen steder hen.",
  useSuggestion: "Brug det",
  notNow: "Ikke nu",
  changed: (area: string) => `Artsnavne kommer nu fra: ${area}. Billeder, du ikke selv har navngivet, gennemgås igen.`,
  regions: {
    palearctic: "Europa, Nordafrika og Nordasien",
    nearctic: "Nordamerika",
    neotropics: "Mellem- og Sydamerika",
    afrotropics: "Afrika syd for Sahara",
    oriental: "Syd- og Sydøstasien",
    australasia: "Australien, Ny Guinea og New Zealand",
    oceans: "Oceaner, øer og polarhave",
  },
};
