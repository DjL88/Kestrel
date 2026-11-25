import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  whereTaken: "Ble tynnwyd y lluniau hyn?",
  whereTakenHint: "Mae enwau rhywogaethau'n cael eu cymharu â'r anifeiliaid sydd i'w cael yno. Mae hyn yn berthnasol i'r prosiect hwn yn unig.",
  home: (region: string) => `Rhanbarth cartref (${region})`,
  worldwide: "Ledled y byd",
  regionsHeading: "Rhanbarthau",
  countriesHeading: "Gwledydd",
  homeSetting: "Rhanbarth cartref",
  homeSettingHint: "Lle rydych chi'n tynnu lluniau fel arfer. Mae prosiectau'n cymharu enwau rhywogaethau â'r rhanbarth hwn oni bai eich bod yn dewis lle arall.",
  matchedIn: (area: string) => `Rhestr rhywogaethau a ddefnyddiwyd: ${area}`,
  promptOutside: (name: string) => `Mae rhai lluniau'n edrych fel rhywogaethau o'r tu allan i'ch rhanbarth cartref, fel ${name}.`,
  suggestionPrivacy: "Wedi'i ddarllen o'r ffeiliau ar y ddyfais hon. Nid yw'r lleoliadau'n cael eu hanfon i unman.",
  usePhotosPlace: (area: string) => `Lleoliadau'r lluniau: ${area}`,
  notNow: "Dim nawr",
  changed: (area: string) => `Mae enwau rhywogaethau bellach yn dod o: ${area}. Mae lluniau nad ydych wedi'u henwi eich hun yn cael eu harchwilio eto.`,
  promptGps: "Mae lleoliadau'r lluniau hyn y tu allan i'ch rhanbarth cartref.",
  regions: {
    palearctic: "Ewrop, Gogledd Affrica a gogledd Asia",
    nearctic: "Gogledd America",
    neotropics: "Canolbarth a De America",
    afrotropics: "Affrica i'r de o'r Sahara",
    oriental: "De a De-ddwyrain Asia",
    australasia: "Awstralia, Gini Newydd a Seland Newydd",
    oceans: "Cefnforoedd, ynysoedd a moroedd pegynol",
  },
};
