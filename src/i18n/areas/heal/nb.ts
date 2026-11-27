import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  title: "Fjern flekker",
  intro: "Dekker støv, en kvist eller rot rundt sittepinnen med piksler kopiert fra like ved i samme bilde. Ingenting blir diktet opp, og originalfilen blir aldri endret.",
  start: "Merk flekker",
  stop: "Ferdig",
  placing: "Klikk eller trykk på hver flekk som skal dekkes. Trykk Escape når du er ferdig.",
  size: "Størrelse",
  feather: "Mykhet",
  method: "Metode",
  heal: "Reparer: gli inn i omgivelsene",
  clone: "Klon: nøyaktig kopi",
  nextSource: "Kopier fra et annet sted",
  remove: "Fjern flekk",
  removeAll: "Fjern alle flekker",
  show: "Vis flekk",
  hide: "Skjul flekk",
  spot: (n: number) => `Flekk ${n}`,
  hidden: "skjult",
  count: (n: number) => plural(n, { one: `${n} flekk`, other: `${n} flekker` }),
  empty: "Ingen flekker ennå.",
  added: "Flekken er dekket. Dra den stiplede sirkelen, eller velg Kopier fra et annet sted, for å endre kilden.",
  full: (n: number) => `Dette bildet har allerede ${n} flekker, det høyeste tillatte.`,
  noSource: "Ingenting i nærheten var likt nok til å kopiere fra. Prøv en mindre størrelse.",
  unreadable: "Bildet kunne ikke leses akkurat nå, så ingen flekk ble lagt til.",
  noOther: "Det finnes ikke noe annet sted i nærheten å kopiere fra.",
  working: "Finner et sted å kopiere fra…",
  historyStep: "Flekkfjerning",
  layer: "Reparerte flekker",
  select: (n: number) => `Flekk ${n}: velg`,
  source: (n: number) => `Kilde for flekk ${n}: dra, eller bruk piltastene`,
};
