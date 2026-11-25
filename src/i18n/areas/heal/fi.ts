import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  title: "Täplien korjaus",
  intro: "Peittää pölyn, oksan tai sotkuisen istumapaikan samasta kuvasta läheltä kopioiduilla pikseleillä. Mitään ei keksitä, eikä alkuperäistä tiedostoa koskaan muuteta.",
  start: "Merkitse täpliä",
  stop: "Valmis",
  placing: "Napsauta tai napauta jokaista peitettävää täplää. Paina Esc, kun olet valmis.",
  size: "Koko",
  feather: "Pehmeys",
  method: "Menetelmä",
  heal: "Korjaa: sulauta ympäristöön",
  clone: "Kloonaa: tarkka kopio",
  nextSource: "Kopioi toisesta kohdasta",
  remove: "Poista täplä",
  removeAll: "Poista kaikki täplät",
  show: "Näytä täplä",
  hide: "Piilota täplä",
  spot: (n: number) => `Täplä ${n}`,
  hidden: "piilotettu",
  count: (n: number) => plural(n, { one: `${n} täplä`, other: `${n} täplää` }),
  empty: "Ei vielä täpliä.",
  added: "Täplä peitetty. Vedä katkoviivaympyrää tai valitse Kopioi toisesta kohdasta vaihtaaksesi lähdettä.",
  full: (n: number) => `Tässä kuvassa on jo ${n} täplää, mikä on enimmäismäärä.`,
  noSource: "Läheltä ei löytynyt tarpeeksi samanlaista kohtaa kopioitavaksi. Kokeile pienempää kokoa.",
  unreadable: "Kuvaa ei voitu lukea juuri nyt, joten täplää ei lisätty.",
  noOther: "Lähellä ei ole muuta kohtaa, josta kopioida.",
  working: "Etsitään kohtaa, josta kopioida…",
  historyStep: "Täplien korjaus",
  layer: "Korjatut täplät",
  select: (n: number) => `Täplä ${n}: valitse`,
  source: (n: number) => `Täplän ${n} lähde: vedä tai käytä nuolinäppäimiä`,
};
