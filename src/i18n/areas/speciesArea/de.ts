import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German. DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  whereTaken: "Wo wurden diese Fotos aufgenommen?",
  whereTakenHint: "Artnamen werden mit den Tieren verglichen, die dort vorkommen. Das gilt nur für dieses Projekt.",
  home: (region: string) => `Heimatregion (${region})`,
  worldwide: "Weltweit",
  regionsHeading: "Regionen",
  countriesHeading: "Länder",
  homeSetting: "Heimatregion",
  homeSettingHint: "Wo Sie normalerweise fotografieren. Projekte vergleichen Artnamen mit dieser Region, sofern Sie keinen anderen Ort wählen.",
  matchedIn: (area: string) => `Verwendete Artenliste: ${area}`,
  promptOutside: (name: string) => `Einige Fotos ähneln Arten außerhalb Ihrer Heimatregion, zum Beispiel ${name}.`,
  suggestionPrivacy: "Aus den Dateien auf diesem Gerät gelesen. Die Orte werden nirgendwohin gesendet.",
  usePhotosPlace: (area: string) => `Aufnahmeorte: ${area}`,
  notNow: "Nicht jetzt",
  changed: (area: string) => `Artnamen kommen jetzt aus: ${area}. Fotos, die Sie nicht selbst benannt haben, werden erneut geprüft.`,
  promptGps: "Die Aufnahmeorte dieser Fotos liegen außerhalb Ihrer Heimatregion.",
  regions: {
    palearctic: "Europa, Nordafrika und Nordasien",
    nearctic: "Nordamerika",
    neotropics: "Mittel- und Südamerika",
    afrotropics: "Afrika südlich der Sahara",
    oriental: "Süd- und Südostasien",
    australasia: "Australien, Neuguinea und Neuseeland",
    oceans: "Ozeane, Inseln und Polarmeere",
  },
};
