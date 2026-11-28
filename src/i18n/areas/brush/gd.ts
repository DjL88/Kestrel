import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. */
export const gd: AreaTranslation<typeof source> = {
  paint: `Peant`,
  erase: `Suath às`,
  mode: `Modh a' bhruis`,
  size: `Meud a' bhruis`,
  stop: `Sguir a pheantadh`,
  layer: (name: string) => `Bruis air ${name}`,
  help: `Slaod air an dealbh airson peantadh. Cum sìos Alt airson suathadh às airson tiotan. Brùth [ no ] airson am meud atharrachadh. Leis a' mheur-chlàr, gluaisidh na saighdean a' bhruis agus peantaidh Space.`,
  painting: (name: string) => `A' peantadh air ${name}. Obraichidh na gleusaidhean aige far am peant thu.`,
  erasing: (name: string) => `A' suathadh às ${name}. Sguiridh na gleusaidhean aige far an suath thu às.`,
  added: `Chaidh masg bruis a chur ris. Slaod air an dealbh airson peantadh far an obraich na gleusaidhean aige.`,
  pickMask: `Fosgail masg bruis, cuspair no cùl-raoin air an liosta gu h-ìosal, an uairsin peant air an dealbh airson cur ris no suathadh às.`,
  refine: `Leasaichidh a' bhruis agus an suathair masg cuspair no cùl-raoin cuideachd: fosgail e air an liosta, an uairsin peant airson cur ris no suath às airson toirt air falbh.`,
  full: (n: number) => `Tha ${n} stràcan bruis air a' mhasg seo mu thràth, an àireamh as motha. Cuir masg bruis eile ris airson cumail a' dol.`,
  strokes: (n: number) => plural(n, { one: `${n} stràc bruis`, other: `${n} stràcan bruis` }),
  unavailable: `'S e ro-shealladh a th' ann am peantadh. Cuir Bruis masg air ann am Feartan ro-shealladh airson a chleachdadh.`,
};
