import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch. DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  whereTaken: "Waar zijn deze foto's gemaakt?",
  whereTakenHint: "Soortnamen worden vergeleken met de dieren die daar voorkomen. Dit geldt alleen voor dit project.",
  home: (region: string) => `Thuisregio (${region})`,
  worldwide: "Wereldwijd",
  regionsHeading: "Regio's",
  countriesHeading: "Landen",
  homeSetting: "Thuisregio",
  homeSettingHint: "Waar je meestal fotografeert. Projecten vergelijken soortnamen met deze regio, tenzij je een andere plek kiest.",
  matchedIn: (area: string) => `Gebruikte soortenlijst: ${area}`,
  promptOutside: (name: string) => `Sommige foto's lijken op soorten van buiten je thuisregio, zoals ${name}.`,
  suggestionPrivacy: "Gelezen uit de bestanden op dit apparaat. De locaties worden nergens heen gestuurd.",
  usePhotosPlace: (area: string) => `Locaties van de foto's: ${area}`,
  notNow: "Niet nu",
  changed: (area: string) => `Soortnamen komen nu uit: ${area}. Foto's die je niet zelf een naam hebt gegeven, worden opnieuw bekeken.`,
  promptGps: "De locaties van deze foto's liggen buiten je thuisregio.",
  regions: {
    palearctic: "Europa, Noord-Afrika en Noord-Azië",
    nearctic: "Noord-Amerika",
    neotropics: "Midden- en Zuid-Amerika",
    afrotropics: "Afrika ten zuiden van de Sahara",
    oriental: "Zuid- en Zuidoost-Azië",
    australasia: "Australië, Nieuw-Guinea en Nieuw-Zeeland",
    oceans: "Oceanen, eilanden en poolzeeën",
  },
};
