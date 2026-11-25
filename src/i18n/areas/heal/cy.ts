import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  title: "Trwsio smotiau",
  intro: "Yn cuddio llwch, brigyn neu annibendod o gwmpas y clwyd gyda phicseli wedi'u copïo o gerllaw yn yr un llun. Does dim yn cael ei greu, a dydy'r ffeil wreiddiol byth yn cael ei newid.",
  start: "Gosod smotiau",
  stop: "Wedi gorffen",
  placing: "Cliciwch neu tapiwch bob smotyn i'w guddio. Pwyswch Escape pan fyddwch wedi gorffen.",
  size: "Maint",
  feather: "Meddalwch",
  method: "Dull",
  heal: "Trwsio: asio â'r amgylchedd",
  clone: "Clonio: copi union",
  nextSource: "Copïo o rywle arall",
  remove: "Tynnu smotyn",
  removeAll: "Tynnu pob smotyn",
  show: "Dangos smotyn",
  hide: "Cuddio smotyn",
  spot: (n: number) => `Smotyn ${n}`,
  hidden: "cudd",
  count: (n: number) => plural(n, { one: `${n} smotyn`, other: `${n} smotyn` }),
  empty: "Dim smotiau eto.",
  added: "Mae'r smotyn wedi'i guddio. Llusgwch y cylch toredig, neu dewiswch Copïo o rywle arall, i newid y ffynhonnell.",
  full: (n: number) => `Mae gan y llun hwn ${n} smotyn yn barod, yr uchafswm.`,
  noSource: "Doedd dim byd gerllaw yn ddigon tebyg i'w gopïo. Rhowch gynnig ar faint llai.",
  unreadable: "Doedd dim modd darllen y llun ar hyn o bryd, felly ni chafodd smotyn ei ychwanegu.",
  noOther: "Does dim lle arall gerllaw i gopïo ohono.",
  working: "Yn chwilio am le i gopïo ohono…",
  historyStep: "Trwsio smotiau",
  layer: "Smotiau wedi'u trwsio",
  select: (n: number) => `Smotyn ${n}: dewis`,
  source: (n: number) => `Ffynhonnell smotyn ${n}: llusgwch neu defnyddiwch y bysellau saeth`,
};
