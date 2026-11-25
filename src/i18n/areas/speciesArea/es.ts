import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish. DRAFT: written without a native speaker's check. */
export const es: AreaTranslation<typeof source> = {
  whereTaken: "¿Dónde se hicieron estas fotos?",
  whereTakenHint: "Los nombres de especies se comparan con los animales que viven allí. Solo afecta a este proyecto.",
  home: (region: string) => `Región habitual (${region})`,
  worldwide: "Todo el mundo",
  regionsHeading: "Regiones",
  countriesHeading: "Países",
  homeSetting: "Región habitual",
  homeSettingHint: "Donde sueles hacer fotos. Los proyectos comparan los nombres de especies con esta región salvo que elijas otro lugar.",
  matchedIn: (area: string) => `Lista de especies usada: ${area}`,
  promptOutside: (name: string) => `Algunas fotos parecen especies de fuera de tu región habitual, como ${name}.`,
  suggestionPrivacy: "Leído de los archivos en este dispositivo. Las ubicaciones no se envían a ningún sitio.",
  usePhotosPlace: (area: string) => `Ubicaciones de las fotos: ${area}`,
  notNow: "Ahora no",
  changed: (area: string) => `Los nombres de especies ahora vienen de: ${area}. Las fotos que no has nombrado tú se vuelven a revisar.`,
  promptGps: "Las ubicaciones de estas fotos están fuera de tu región habitual.",
  regions: {
    palearctic: "Europa, norte de África y norte de Asia",
    nearctic: "Norteamérica",
    neotropics: "Centroamérica y Sudamérica",
    afrotropics: "África subsahariana",
    oriental: "Asia meridional y sudoriental",
    australasia: "Australia, Nueva Guinea y Nueva Zelanda",
    oceans: "Océanos, islas y mares polares",
  },
};
