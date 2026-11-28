import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  open: `Livefotografering`,
  openHint: `Start en livefotografering: billederne kommer ind i dette projekt, mens du fotograferer.`,
  title: `Livefotografering`,
  intro: `Billederne kommer ind i dette projekt, mens du fotograferer. Intet ændres på kameraet eller i mappen. Endnu ikke testet med et rigtigt kamera.`,
  source: `Hvor billederne kommer fra`,
  folder: `En mappe`,
  folderHint: `En tether-app eller et andet program gemmer billeder i en mappe, du vælger.`,
  ftpHint: `Kameraet sender hvert billede til denne computer over det lokale netværk.`,
  usbHint: `En forhåndsvisning: indtil videre kun afprøvet med et simuleret kamera.`,
  look: `Look til de næste billeder`,
  lookNone: `Ingen: billederne kommer, som de er taget`,
  lookNote: `Hvert nyt billede får dette look som sin egen redigering. Looks › Ingen eller Nulstil fjerner det. Den originale fil ændres aldrig.`,
  room: `Vis på andre skærme på dette netværk`,
  roomNote: `En kundes tablet eller en studieskærm kan se billederne og give stjerner og valg. Dine egne markeringer vinder altid.`,
  start: `Start livefotografering`,
  stop: `Stop livefotografering`,
  close: `Luk og stop`,
  closeNote: `Når du lukker dette panel, stopper livefotograferingen, og kameraindbakken og rummet slukkes.`,
  running: (n: number) => plural(n, { one: `Livefotografering kører · ${n} billede indtil nu`, other: `Livefotografering kører · ${n} billeder indtil nu` }),
  lookOn: (name: string) => `Look til de næste billeder: ${name}`,
  ftpSame: `De er de samme hver gang på denne computer, så kameraet beholder sine indstillinger.`,
  portChanged: (port: number) => `Den sædvanlige port var optaget, så denne fotografering bruger port ${port}. Skriv den i kameraet, eller luk det andet program og start igen.`,
  newPassword: `Lav en ny adgangskode`,
  newPasswordNote: `Skriv derefter den nye adgangskode i kameraet.`,
  roomHeading: `Åbn denne adresse på den anden skærm`,
  starting: `Starter…`,
};
