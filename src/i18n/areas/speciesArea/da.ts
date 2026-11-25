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
  promptOutside: (name: string) => `Nogle billeder ligner arter uden for din hjemregion, f.eks. ${name}.`,
  suggestionPrivacy: "Læst fra filerne på denne enhed. Stederne sendes ingen steder hen.",
  usePhotosPlace: (area: string) => `Billedernes steder: ${area}`,
  notNow: "Ikke nu",
  changed: (area: string) => `Artsnavne kommer nu fra: ${area}. Billeder, du ikke selv har navngivet, gennemgås igen.`,
  promptGps: "Disse billeders steder ligger uden for din hjemregion.",
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
