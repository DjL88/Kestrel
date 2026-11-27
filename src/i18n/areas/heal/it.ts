import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  title: "Rimuovi macchie",
  intro: "Copre polvere, un rametto o un posatoio ingombrante con pixel copiati da una zona vicina della stessa foto. Nulla viene inventato e il file originale non viene mai modificato.",
  start: "Segna macchie",
  stop: "Fatto",
  placing: "Faccia clic o tocchi ogni macchia da coprire. Prema Esc quando ha finito.",
  size: "Dimensione",
  feather: "Morbidezza",
  method: "Metodo",
  heal: "Correggi: fondi con i dintorni",
  clone: "Clona: copia esatta",
  nextSource: "Copia da un altro punto",
  remove: "Rimuovi macchia",
  removeAll: "Rimuovi tutte le macchie",
  show: "Mostra macchia",
  hide: "Nascondi macchia",
  spot: (n: number) => `Macchia ${n}`,
  hidden: "nascosta",
  count: (n: number) => plural(n, { one: `${n} macchia`, other: `${n} macchie` }),
  empty: "Ancora nessuna macchia.",
  added: "Macchia coperta. Trascini il cerchio tratteggiato, o scelga Copia da un altro punto, per cambiare la sorgente.",
  full: (n: number) => `Questa foto ha già ${n} macchie, il massimo consentito.`,
  noSource: "Nelle vicinanze non c'era nulla di abbastanza simile da copiare. Provi una dimensione più piccola.",
  unreadable: "Non è stato possibile leggere la foto in questo momento, quindi non è stata aggiunta nessuna macchia.",
  noOther: "Non c'è un altro punto vicino da cui copiare.",
  working: "Ricerca di un punto da cui copiare…",
  historyStep: "Correzione macchie",
  layer: "Macchie corrette",
  select: (n: number) => `Macchia ${n}: seleziona`,
  source: (n: number) => `Sorgente della macchia ${n}: trascini o usi le frecce`,
};
