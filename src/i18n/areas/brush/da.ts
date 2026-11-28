import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  paint: `Mal`,
  erase: `Visk ud`,
  mode: `Penseltilstand`,
  size: `Penselstørrelse`,
  stop: `Stop med at male`,
  layer: (name: string) => `Pensel på ${name}`,
  help: `Træk på fotoet for at male. Hold Alt nede for at viske ud et øjeblik. Tryk på [ eller ] for at ændre størrelsen. Med tastaturet flytter piletasterne penslen, og mellemrum maler.`,
  painting: (name: string) => `Du maler på ${name}. Dens justeringer gælder, hvor du maler.`,
  erasing: (name: string) => `Du visker ud fra ${name}. Dens justeringer stopper, hvor du visker ud.`,
  added: `Penselmaske tilføjet. Træk på fotoet for at male, hvor dens justeringer skal gælde.`,
  pickMask: `Åbn en pensel-, motiv- eller baggrundsmaske i listen nedenfor, og mal så på fotoet for at udvide den eller viske ud.`,
  refine: `Pensel og viskelæder forfiner også en motiv- eller baggrundsmaske: Åbn den i listen, og mal for at tilføje eller visk ud for at fjerne.`,
  full: (n: number) => `Denne maske har allerede ${n} penselstrøg, det højeste antal. Tilføj en ny penselmaske for at male videre.`,
  strokes: (n: number) => plural(n, { one: `${n} penselstrøg`, other: `${n} penselstrøg` }),
  unavailable: `Maling er en prøvefunktion. Slå Maskepensel til under Prøvefunktioner for at bruge den.`,
};
