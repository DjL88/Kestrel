import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  whereTaken: "Hvar voru þessar myndir teknar?",
  whereTakenHint: "Tegundaheiti eru borin saman við dýrin sem finnast þar. Þetta gildir aðeins um þetta verkefni.",
  home: (region: string) => `Heimasvæði (${region})`,
  worldwide: "Allur heimurinn",
  regionsHeading: "Svæði",
  countriesHeading: "Lönd",
  homeSetting: "Heimasvæði",
  homeSettingHint: "Þar sem þú tekur venjulega myndir. Verkefni bera tegundaheiti saman við þetta svæði nema þú veljir annan stað.",
  matchedIn: (area: string) => `Tegundalisti notaður: ${area}`,
  promptOutside: (name: string) => `Sumar myndir líkjast tegundum utan heimasvæðis þíns, t.d. ${name}.`,
  suggestionPrivacy: "Lesið úr skránum á þessu tæki. Staðsetningar eru ekki sendar neitt.",
  usePhotosPlace: (area: string) => `Staðsetningar mynda: ${area}`,
  notNow: "Ekki núna",
  changed: (area: string) => `Tegundaheiti koma nú frá: ${area}. Myndir sem þú hefur ekki nefnt sjálf(ur) eru skoðaðar aftur.`,
  promptGps: "Staðsetningar þessara mynda eru utan heimasvæðis þíns.",
  regions: {
    palearctic: "Evrópa, Norður-Afríka og Norður-Asía",
    nearctic: "Norður-Ameríka",
    neotropics: "Mið- og Suður-Ameríka",
    afrotropics: "Afríka sunnan Sahara",
    oriental: "Suður- og Suðaustur-Asía",
    australasia: "Ástralía, Nýja-Gínea og Nýja-Sjáland",
    oceans: "Höf, eyjar og heimskautahöf",
  },
};
