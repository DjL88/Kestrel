import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  whereTaken: "Missä nämä kuvat on otettu?",
  whereTakenHint: "Lajinimiä verrataan siellä eläviin eläimiin. Valinta koskee vain tätä projektia.",
  home: (region: string) => `Kotialue (${region})`,
  worldwide: "Koko maailma",
  regionsHeading: "Alueet",
  countriesHeading: "Maat",
  homeSetting: "Kotialue",
  homeSettingHint: "Missä yleensä kuvaat. Projektit vertaavat lajinimiä tähän alueeseen, ellet valitse niille muuta paikkaa.",
  matchedIn: (area: string) => `Käytetty lajiluettelo: ${area}`,
  suggestion: (area: string) => `Kuvien sijainnit viittaavat alueeseen: ${area}.`,
  suggestionPrivacy: "Luettu tämän laitteen tiedostoista. Sijainteja ei lähetetä minnekään.",
  useSuggestion: "Käytä",
  notNow: "Ei nyt",
  changed: (area: string) => `Lajinimet tulevat nyt alueelta: ${area}. Kuvat, joita et ole itse nimennyt, tarkistetaan uudelleen.`,
  regions: {
    palearctic: "Eurooppa, Pohjois-Afrikka ja Pohjois-Aasia",
    nearctic: "Pohjois-Amerikka",
    neotropics: "Väli- ja Etelä-Amerikka",
    afrotropics: "Saharan eteläpuolinen Afrikka",
    oriental: "Etelä- ja Kaakkois-Aasia",
    australasia: "Australia, Uusi-Guinea ja Uusi-Seelanti",
    oceans: "Valtameret, saaret ja napameret",
  },
};
