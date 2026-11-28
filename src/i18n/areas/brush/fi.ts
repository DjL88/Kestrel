import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  paint: `Maalaa`,
  erase: `Pyyhi`,
  mode: `Siveltimen tila`,
  size: `Siveltimen koko`,
  stop: `Lopeta maalaaminen`,
  layer: (name: string) => `Sivellin: ${name}`,
  help: `Maalaa vetämällä kuvan päällä. Pidä Alt painettuna, niin voit pyyhkiä hetken. Muuta kokoa näppäimillä [ ja ]. Näppäimistöllä nuolinäppäimet siirtävät sivellintä ja välilyönti maalaa.`,
  painting: (name: string) => `Maalaat maskiin ${name}. Sen säädöt vaikuttavat siellä, mihin maalaat.`,
  erasing: (name: string) => `Pyyhit maskista ${name}. Sen säädöt lakkaavat vaikuttamasta siellä, mistä pyyhit.`,
  added: `Sivellinmaski lisätty. Maalaa vetämällä kuvan päällä kohtiin, joihin sen säätöjen pitää vaikuttaa.`,
  pickMask: `Avaa alla olevasta luettelosta sivellin-, kohde- tai taustamaski ja maalaa sitten kuvan päällä laajentaaksesi sitä tai pyyhkiäksesi siitä.`,
  refine: `Sivellin ja pyyhekumi tarkentavat myös kohde- tai taustamaskia: avaa se luettelosta, maalaa lisätäksesi tai pyyhi poistaaksesi.`,
  full: (n: number) => `Tässä maskissa on jo ${n} sivellinvetoa, enimmäismäärä. Lisää uusi sivellinmaski jatkaaksesi maalaamista.`,
  strokes: (n: number) => plural(n, { one: `${n} sivellinveto`, other: `${n} sivellinvetoa` }),
  unavailable: `Maalaaminen on esikatseluominaisuus. Ota Maskisivellin käyttöön kohdassa Esikatseluominaisuudet.`,
};
