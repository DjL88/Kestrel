import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  whereTaken: "Cá háit ar tógadh na grianghraif seo?",
  whereTakenHint: "Cuirtear ainmneacha speiceas i gcomparáid leis na hainmhithe atá le fáil ansin. Ní bhaineann sé seo ach leis an tionscadal seo.",
  home: (region: string) => `Réigiún baile (${region})`,
  worldwide: "Ar fud an domhain",
  regionsHeading: "Réigiúin",
  countriesHeading: "Tíortha",
  homeSetting: "Réigiún baile",
  homeSettingHint: "An áit a dtógann tú grianghraif de ghnáth. Cuireann tionscadail ainmneacha speiceas i gcomparáid leis an réigiún seo mura roghnaíonn tú áit eile.",
  matchedIn: (area: string) => `Liosta speiceas a úsáideadh: ${area}`,
  promptOutside: (name: string) => `Tá cuma speiceas ó lasmuigh de do réigiún baile ar roinnt grianghraf, mar shampla ${name}.`,
  suggestionPrivacy: "Léite ó na comhaid ar an ngléas seo. Ní sheoltar na suíomhanna áit ar bith.",
  usePhotosPlace: (area: string) => `Suíomhanna na ngrianghraf: ${area}`,
  notNow: "Ní anois",
  changed: (area: string) => `Tagann ainmneacha speiceas anois ó: ${area}. Breathnaítear arís ar ghrianghraif nár ainmnigh tú féin.`,
  promptGps: "Tá suíomhanna na ngrianghraf seo lasmuigh de do réigiún baile.",
  regions: {
    palearctic: "An Eoraip, an Afraic Thuaidh agus an Áise Thuaidh",
    nearctic: "Meiriceá Thuaidh",
    neotropics: "Meiriceá Láir agus Theas",
    afrotropics: "An Afraic ó dheas den Sahára",
    oriental: "An Áise Theas agus Oirdheisceart na hÁise",
    australasia: "An Astráil, an Ghuine Nua agus an Nua-Shéalainn",
    oceans: "Aigéin, oileáin agus farraigí polacha",
  },
};
