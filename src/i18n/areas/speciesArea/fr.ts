import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French. DRAFT: written without a native speaker's check. */
export const fr: AreaTranslation<typeof source> = {
  whereTaken: "Où ces photos ont-elles été prises ?",
  whereTakenHint: "Les noms d'espèces sont comparés aux animaux présents à cet endroit. Ce choix ne concerne que ce projet.",
  home: (region: string) => `Région habituelle (${region})`,
  worldwide: "Monde entier",
  regionsHeading: "Régions",
  countriesHeading: "Pays",
  homeSetting: "Région habituelle",
  homeSettingHint: "Là où vous photographiez d'habitude. Les projets comparent les noms d'espèces à cette région, sauf si vous choisissez un autre lieu.",
  matchedIn: (area: string) => `Liste d'espèces utilisée : ${area}`,
  suggestion: (area: string) => `Les lieux des photos suggèrent : ${area}.`,
  suggestionPrivacy: "Lu dans les fichiers sur cet appareil. Les lieux ne sont envoyés nulle part.",
  useSuggestion: "Utiliser",
  notNow: "Pas maintenant",
  changed: (area: string) => `Les noms d'espèces viennent maintenant de : ${area}. Les photos que vous n'avez pas nommées vous-même sont réexaminées.`,
  regions: {
    palearctic: "Europe, Afrique du Nord et Asie du Nord",
    nearctic: "Amérique du Nord",
    neotropics: "Amérique centrale et du Sud",
    afrotropics: "Afrique subsaharienne",
    oriental: "Asie du Sud et du Sud-Est",
    australasia: "Australie, Nouvelle-Guinée et Nouvelle-Zélande",
    oceans: "Océans, îles et mers polaires",
  },
};
