import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  paint: `Mála`,
  erase: `Stroka út`,
  mode: `Penslahamur`,
  size: `Penslastærð`,
  stop: `Hætta að mála`,
  layer: (name: string) => `Pensill á ${name}`,
  help: `Dragðu yfir myndina til að mála. Haltu Alt inni til að stroka út í smástund. Ýttu á [ eða ] til að breyta stærðinni. Á lyklaborði færa örvalyklarnir pensilinn og bilslá málar.`,
  painting: (name: string) => `Þú málar á ${name}. Stillingar hans gilda þar sem þú málar.`,
  erasing: (name: string) => `Þú strokar út úr ${name}. Stillingar hans hætta að gilda þar sem þú strokar út.`,
  added: `Penslagríma bætt við. Dragðu yfir myndina til að mála þar sem stillingar hennar eiga að gilda.`,
  pickMask: `Opnaðu penslagrímu, viðfangsgrímu eða bakgrunnsgrímu í listanum hér fyrir neðan og málaðu svo á myndina til að stækka hana eða stroka út.`,
  refine: `Pensill og strokleður fínstilla líka viðfangs- eða bakgrunnsgrímu: opnaðu hana í listanum, málaðu til að bæta við eða strokaðu út til að fjarlægja.`,
  full: (n: number) => `Þessi gríma er þegar með ${n} pensilstrokur, hámarkið. Bættu við annarri penslagrímu til að halda áfram að mála.`,
  strokes: (n: number) => plural(n, { one: `${n} pensilstroka`, other: `${n} pensilstrokur` }),
  unavailable: `Málun er forskoðun. Kveiktu á Grímupensli í Forskoðunareiginleikar til að nota hana.`,
};
