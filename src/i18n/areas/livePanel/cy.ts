import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  open: `Saethu byw`,
  openHint: `Dechreuwch saethu byw: mae lluniau'n cyrraedd y prosiect hwn wrth i chi eu tynnu.`,
  title: `Saethu byw`,
  intro: `Mae lluniau'n cyrraedd y prosiect hwn wrth i chi eu tynnu. Ni chaiff dim ei newid ar y camera nac yn y ffolder. Heb ei brofi gyda chamera go iawn eto.`,
  source: `O ble daw'r lluniau`,
  folder: `Ffolder`,
  folderHint: `Mae ap clymu neu raglen arall yn cadw lluniau mewn ffolder o'ch dewis.`,
  ftpHint: `Mae'r camera'n anfon pob llun i'r cyfrifiadur hwn dros y rhwydwaith lleol.`,
  usbHint: `Rhagolwg: wedi'i brofi gyda chamera efelychiedig yn unig hyd yma.`,
  look: `Golwg ar gyfer y lluniau nesaf`,
  lookNone: `Dim: mae lluniau'n cyrraedd fel y'u tynnwyd`,
  lookNote: `Mae pob llun newydd yn cael y golwg hon fel ei olygiad ei hun. Mae Golygon › Dim neu Ailosod yn ei dynnu. Nid yw'r ffeil wreiddiol byth yn cael ei newid.`,
  room: `Dangos ar sgriniau eraill ar y rhwydwaith hwn`,
  roomNote: `Gall llechen cleient neu sgrin stiwdio weld y lluniau ac ychwanegu sêr a dewisiadau. Eich marciau chi sy'n ennill bob tro.`,
  start: `Dechrau saethu byw`,
  stop: `Stopio saethu byw`,
  close: `Cau a stopio`,
  closeNote: `Mae cau'r panel hwn yn stopio'r saethu byw ac yn diffodd mewnflwch y camera a'r ystafell.`,
  running: (n: number) => plural(n, { one: `Saethu byw ar waith · ${n} llun hyd yma`, other: `Saethu byw ar waith · ${n} llun hyd yma` }),
  lookOn: (name: string) => `Golwg ar gyfer y lluniau nesaf: ${name}`,
  ftpSame: `Mae'r rhain yr un fath bob tro ar y cyfrifiadur hwn, felly mae'r camera'n cadw ei osodiadau.`,
  portChanged: (port: number) => `Roedd y porth arferol yn cael ei ddefnyddio, felly mae'r saethu hwn yn defnyddio porth ${port}. Teipiwch ef yn y camera, neu caewch y rhaglen arall a dechrau eto.`,
  newPassword: `Creu cyfrinair newydd`,
  newPasswordNote: `Yna teipiwch y cyfrinair newydd yn y camera.`,
  roomHeading: `Agorwch y cyfeiriad hwn ar y sgrin arall`,
  starting: `Wrthi'n dechrau…`,
};
