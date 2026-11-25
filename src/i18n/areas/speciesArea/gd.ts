import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  whereTaken: "Càite an deach na dealbhan seo a thogail?",
  whereTakenHint: "Thèid ainmean ghnèithean a choimeas ris na beathaichean a tha ann an sin. Chan eil seo a' buntainn ach ris a' phròiseact seo.",
  home: (region: string) => `Roinn-dachaigh (${region})`,
  worldwide: "Air feadh an t-saoghail",
  regionsHeading: "Roinnean",
  countriesHeading: "Dùthchannan",
  homeSetting: "Roinn-dachaigh",
  homeSettingHint: "Far am bi thu a' togail dhealbhan mar as àbhaist. Bidh pròiseactan a' coimeas ainmean ghnèithean ris an roinn seo mura tagh thu àite eile.",
  matchedIn: (area: string) => `Liosta ghnèithean a chaidh a chleachdadh: ${area}`,
  promptOutside: (name: string) => `Tha cuid de dhealbhan coltach ri gnèithean o thaobh a-muigh na roinn-dachaigh agad, mar ${name}.`,
  suggestionPrivacy: "Air a leughadh bho na faidhlichean air an uidheam seo. Cha tèid na h-ionadan a chur gu àite sam bith.",
  usePhotosPlace: (area: string) => `Ionadan nan dealbhan: ${area}`,
  notNow: "Chan ann an-dràsta",
  changed: (area: string) => `Tha ainmean ghnèithean a-nis a' tighinn à: ${area}. Thèid sùil a thoirt a-rithist air dealbhan nach do dh'ainmich thu fhèin.`,
  promptGps: "Tha ionadan nan dealbhan seo taobh a-muigh na roinn-dachaigh agad.",
  regions: {
    palearctic: "An Roinn Eòrpa, Afraga a Tuath agus Àisia a Tuath",
    nearctic: "Ameireaga a Tuath",
    neotropics: "Ameireaga Mheadhanach is a Deas",
    afrotropics: "Afraga deas air an t-Sahara",
    oriental: "Àisia a Deas is an Ear-dheas",
    australasia: "Astràilia, Gini Ùr agus Sealainn Nuadh",
    oceans: "Cuantan, eileanan agus cuantan pòlach",
  },
};
