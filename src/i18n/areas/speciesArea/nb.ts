import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  whereTaken: "Hvor ble disse bildene tatt?",
  whereTakenHint: "Artsnavn sammenlignes med dyrene som finnes der. Dette gjelder bare dette prosjektet.",
  home: (region: string) => `Hjemregion (${region})`,
  worldwide: "Hele verden",
  regionsHeading: "Regioner",
  countriesHeading: "Land",
  homeSetting: "Hjemregion",
  homeSettingHint: "Der du vanligvis fotograferer. Prosjekter sammenligner artsnavn med denne regionen, med mindre du velger et annet sted.",
  matchedIn: (area: string) => `Artsliste brukt: ${area}`,
  suggestion: (area: string) => `Stedene i bildene tyder på: ${area}.`,
  suggestionPrivacy: "Lest fra filene på denne enheten. Stedene sendes ingen steder.",
  useSuggestion: "Bruk dette",
  notNow: "Ikke nå",
  changed: (area: string) => `Artsnavn kommer nå fra: ${area}. Bilder du ikke har navngitt selv, blir sett på igjen.`,
  regions: {
    palearctic: "Europa, Nord-Afrika og Nord-Asia",
    nearctic: "Nord-Amerika",
    neotropics: "Mellom- og Sør-Amerika",
    afrotropics: "Afrika sør for Sahara",
    oriental: "Sør- og Sørøst-Asia",
    australasia: "Australia, Ny-Guinea og New Zealand",
    oceans: "Hav, øyer og polarhav",
  },
};
