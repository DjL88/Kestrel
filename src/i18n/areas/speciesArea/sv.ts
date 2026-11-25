import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  whereTaken: "Var togs de här bilderna?",
  whereTakenHint: "Artnamn jämförs med de djur som finns där. Det gäller bara det här projektet.",
  home: (region: string) => `Hemregion (${region})`,
  worldwide: "Hela världen",
  regionsHeading: "Regioner",
  countriesHeading: "Länder",
  homeSetting: "Hemregion",
  homeSettingHint: "Där du brukar fotografera. Projekt jämför artnamn med den här regionen om du inte väljer en annan plats.",
  matchedIn: (area: string) => `Artlista som används: ${area}`,
  suggestion: (area: string) => `Bildernas platser tyder på: ${area}.`,
  suggestionPrivacy: "Läst från filerna på den här enheten. Platserna skickas inte någonstans.",
  useSuggestion: "Använd",
  notNow: "Inte nu",
  changed: (area: string) => `Artnamn kommer nu från: ${area}. Bilder som du inte har namngett själv granskas igen.`,
  regions: {
    palearctic: "Europa, Nordafrika och norra Asien",
    nearctic: "Nordamerika",
    neotropics: "Central- och Sydamerika",
    afrotropics: "Afrika söder om Sahara",
    oriental: "Syd- och Sydostasien",
    australasia: "Australien, Nya Guinea och Nya Zeeland",
    oceans: "Hav, öar och polarhav",
  },
};
