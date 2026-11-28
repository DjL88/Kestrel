import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  paint: `Mal`,
  erase: `Visk ut`,
  mode: `Penselmodus`,
  size: `Penselstørrelse`,
  stop: `Slutt å male`,
  layer: (name: string) => `Pensel på ${name}`,
  help: `Dra på bildet for å male. Hold Alt nede for å viske ut et øyeblikk. Trykk [ eller ] for å endre størrelsen. Med tastaturet flytter piltastene penselen, og mellomrom maler.`,
  painting: (name: string) => `Du maler på ${name}. Justeringene gjelder der du maler.`,
  erasing: (name: string) => `Du visker ut fra ${name}. Justeringene slutter å gjelde der du visker ut.`,
  added: `Penselmaske lagt til. Dra på bildet for å male der justeringene skal gjelde.`,
  pickMask: `Åpne en pensel-, motiv- eller bakgrunnsmaske i listen nedenfor, og mal så på bildet for å utvide den eller viske ut.`,
  refine: `Pensel og viskelær finjusterer også en motiv- eller bakgrunnsmaske: Åpne den i listen, og mal for å legge til eller visk ut for å fjerne.`,
  full: (n: number) => `Denne masken har allerede ${n} penselstrøk, det høyeste antallet. Legg til en ny penselmaske for å male videre.`,
  strokes: (n: number) => plural(n, { one: `${n} penselstrøk`, other: `${n} penselstrøk` }),
  unavailable: `Maling er en forhåndsfunksjon. Slå på Maskepensel under Forhåndsfunksjoner for å bruke den.`,
};
