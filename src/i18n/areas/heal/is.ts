import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  title: "Fjarlægja bletti",
  intro: "Hylur ryk, kvist eða drasl við setstaðinn með dílum sem eru afritaðir úr næsta nágrenni í sömu mynd. Ekkert er búið til og upprunalegu skránni er aldrei breytt.",
  start: "Merkja bletti",
  stop: "Lokið",
  placing: "Smelltu eða ýttu á hvern blett sem á að hylja. Ýttu á Escape þegar þú ert búin(n).",
  size: "Stærð",
  feather: "Mýkt",
  method: "Aðferð",
  heal: "Lagfæra: fella að umhverfinu",
  clone: "Klóna: nákvæmt afrit",
  nextSource: "Afrita frá öðrum stað",
  remove: "Fjarlægja blett",
  removeAll: "Fjarlægja alla bletti",
  show: "Sýna blett",
  hide: "Fela blett",
  spot: (n: number) => `Blettur ${n}`,
  hidden: "falinn",
  count: (n: number) => plural(n, { one: `${n} blettur`, other: `${n} blettir` }),
  empty: "Engir blettir enn.",
  added: "Bletturinn er hulinn. Dragðu brotalínuhringinn, eða veldu Afrita frá öðrum stað, til að breyta upprunanum.",
  full: (n: number) => `Þessi mynd er þegar með ${n} bletti, hámarkið.`,
  noSource: "Ekkert í grenndinni var nógu líkt til að afrita. Prófaðu minni stærð.",
  unreadable: "Ekki tókst að lesa myndina núna, svo engum bletti var bætt við.",
  noOther: "Það er enginn annar staður í grenndinni til að afrita frá.",
  working: "Leitar að stað til að afrita frá…",
  historyStep: "Blettahreinsun",
  layer: "Lagfærðir blettir",
  select: (n: number) => `Blettur ${n}: velja`,
  source: (n: number) => `Uppruni bletts ${n}: dragðu eða notaðu örvalyklana`,
};
