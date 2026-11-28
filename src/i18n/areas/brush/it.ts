import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (Lei). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  paint: `Dipingi`,
  erase: `Cancella`,
  mode: `Modalità pennello`,
  size: `Dimensione pennello`,
  stop: `Smetti di dipingere`,
  layer: (name: string) => `Pennello su ${name}`,
  help: `Trascini sulla foto per dipingere. Tenga premuto Alt per cancellare un momento. Prema [ o ] per cambiare la dimensione. Da tastiera, le frecce spostano il pennello e la barra spaziatrice dipinge.`,
  painting: (name: string) => `Sta dipingendo su ${name}. Le sue regolazioni si applicano dove dipinge.`,
  erasing: (name: string) => `Sta cancellando da ${name}. Le sue regolazioni smettono dove cancella.`,
  added: `Maschera a pennello aggiunta. Trascini sulla foto per dipingere dove si applicano le sue regolazioni.`,
  pickMask: `Apra una maschera a pennello, del soggetto o dello sfondo nell'elenco qui sotto, poi dipinga sulla foto per ampliarla o cancellarla.`,
  refine: `Pennello e gomma affinano anche una maschera del soggetto o dello sfondo: la apra nell'elenco, poi dipinga per aggiungere o cancelli per togliere.`,
  full: (n: number) => `Questa maschera ha già ${n} pennellate, il massimo. Aggiunga un'altra maschera a pennello per continuare.`,
  strokes: (n: number) => plural(n, { one: `${n} pennellata`, other: `${n} pennellate` }),
  unavailable: `Dipingere è un'anteprima. Attivi Pennello maschera in Funzioni in anteprima per usarlo.`,
};
