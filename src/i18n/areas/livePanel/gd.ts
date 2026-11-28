import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  open: `Togail bheò`,
  openHint: `Tòisich togail bheò: thig dealbhan dhan phròiseact seo fhad 's a thogas tu iad.`,
  title: `Togail bheò`,
  intro: `Thig dealbhan dhan phròiseact seo fhad 's a thogas tu iad. Cha tèid dad atharrachadh air a' chamara no sa phasgan. Cha deach a dhearbhadh le fìor chamara fhathast.`,
  source: `Cò às a thig na dealbhan`,
  folder: `Pasgan`,
  folderHint: `Sàbhailidh aplacaid ceangail no prògram eile dealbhan ann am pasgan a thaghas tu.`,
  ftpHint: `Cuiridh an camara gach dealbh dhan choimpiutair seo thairis air an lìonra ionadail.`,
  usbHint: `Ro-shealladh: cha deach fheuchainn ach le camara samhlachail gu ruige seo.`,
  look: `Coltas nan ath dhealbhan`,
  lookNone: `Chan eil gin: thig dealbhan mar a chaidh an togail`,
  lookNote: `Gheibh gach dealbh ùr an coltas seo mar an deasachadh aige fhèin. Bheir Coltasan › Chan eil gin no Ath-shuidhich air falbh e. Cha tèid am faidhle tùsail atharrachadh idir.`,
  room: `Seall air sgrìnichean eile air an lìonra seo`,
  roomNote: `Chì tablaid neach-dèiligidh no sgrìn stiùidio na dealbhan agus cuiridh iad rionnagan is taghaidhean riutha. Bidh na comharran agad fhèin an-còmhnaidh air thoiseach.`,
  start: `Tòisich togail bheò`,
  stop: `Cuir stad air togail bheò`,
  close: `Dùin agus stad`,
  closeNote: `Ma dhùineas tu an leòsan seo, stadaidh an togail bheò agus thèid bogsa a-steach a' chamara is an rùm a chur dheth.`,
  running: (n: number) => plural(n, { one: `Togail bheò a' dol · ${n} dealbh gu ruige seo`, other: `Togail bheò a' dol · ${n} dealbhan gu ruige seo` }),
  lookOn: (name: string) => `Coltas nan ath dhealbhan: ${name}`,
  ftpSame: `Bidh iad seo co-ionann gach turas air a' choimpiutair seo, mar sin cumaidh an camara a roghainnean.`,
  portChanged: (port: number) => `Bha am port àbhaisteach ga chleachdadh, mar sin cleachdaidh an togail seo port ${port}. Cuir a-steach e air a' chamara, no dùin am prògram eile is tòisich a-rithist.`,
  newPassword: `Dèan facal-faire ùr`,
  newPasswordNote: `An uairsin cuir am facal-faire ùr a-steach air a' chamara.`,
  roomHeading: `Fosgail an seòladh seo air an sgrìn eile`,
  starting: `A' tòiseachadh…`,
};
