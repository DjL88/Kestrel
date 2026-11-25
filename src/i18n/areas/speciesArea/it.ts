import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian. DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  whereTaken: "Dove sono state scattate queste foto?",
  whereTakenHint: "I nomi delle specie vengono confrontati con gli animali presenti in quel luogo. Vale solo per questo progetto.",
  home: (region: string) => `Regione abituale (${region})`,
  worldwide: "Tutto il mondo",
  regionsHeading: "Regioni",
  countriesHeading: "Paesi",
  homeSetting: "Regione abituale",
  homeSettingHint: "Dove fotografi di solito. I progetti confrontano i nomi delle specie con questa regione, a meno che tu non scelga un altro luogo.",
  matchedIn: (area: string) => `Elenco di specie usato: ${area}`,
  promptOutside: (name: string) => `Alcune foto sembrano specie di fuori dalla tua regione abituale, come ${name}.`,
  suggestionPrivacy: "Letto dai file su questo dispositivo. I luoghi non vengono inviati da nessuna parte.",
  usePhotosPlace: (area: string) => `Luoghi delle foto: ${area}`,
  notNow: "Non ora",
  changed: (area: string) => `I nomi delle specie ora provengono da: ${area}. Le foto a cui non hai dato un nome vengono riesaminate.`,
  promptGps: "I luoghi di queste foto sono fuori dalla tua regione abituale.",
  regions: {
    palearctic: "Europa, Nord Africa e Asia settentrionale",
    nearctic: "Nord America",
    neotropics: "America centrale e meridionale",
    afrotropics: "Africa subsahariana",
    oriental: "Asia meridionale e sud-orientale",
    australasia: "Australia, Nuova Guinea e Nuova Zelanda",
    oceans: "Oceani, isole e mari polari",
  },
};
