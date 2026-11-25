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
  promptOutside: (name: string) => `Jotkin kuvat muistuttavat kotialueesi ulkopuolisia lajeja, kuten ${name}.`,
  suggestionPrivacy: "Luettu tämän laitteen tiedostoista. Sijainteja ei lähetetä minnekään.",
  usePhotosPlace: (area: string) => `Kuvien sijainnit: ${area}`,
  notNow: "Ei nyt",
  changed: (area: string) => `Lajinimet tulevat nyt alueelta: ${area}. Kuvat, joita et ole itse nimennyt, tarkistetaan uudelleen.`,
  promptGps: "Näiden kuvien sijainnit ovat kotialueesi ulkopuolella.",
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
