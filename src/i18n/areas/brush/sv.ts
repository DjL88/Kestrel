import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  paint: `Måla`,
  erase: `Sudda`,
  mode: `Penselläge`,
  size: `Penselstorlek`,
  stop: `Sluta måla`,
  layer: (name: string) => `Pensel på ${name}`,
  help: `Dra på fotot för att måla. Håll ned Alt för att sudda en stund. Tryck på [ eller ] för att ändra storleken. Med tangentbordet flyttar piltangenterna penseln och mellanslag målar.`,
  painting: (name: string) => `Du målar på ${name}. Dess justeringar gäller där du målar.`,
  erasing: (name: string) => `Du suddar i ${name}. Dess justeringar slutar gälla där du suddar.`,
  added: `Penselmask tillagd. Dra på fotot för att måla där dess justeringar ska gälla.`,
  pickMask: `Öppna en pensel-, motiv- eller bakgrundsmask i listan nedan och måla sedan på fotot för att utöka den eller sudda.`,
  refine: `Pensel och suddgummi förfinar också en motiv- eller bakgrundsmask: öppna den i listan och måla för att lägga till eller sudda för att ta bort.`,
  full: (n: number) => `Den här masken har redan ${n} penseldrag, det högsta antalet. Lägg till en ny penselmask för att fortsätta måla.`,
  strokes: (n: number) => plural(n, { one: `${n} penseldrag`, other: `${n} penseldrag` }),
  unavailable: `Målning är en förhandsfunktion. Slå på Maskpensel under Förhandsfunktioner för att använda den.`,
};
