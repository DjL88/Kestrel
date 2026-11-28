import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. */
export const cy: AreaTranslation<typeof source> = {
  paint: `Peintio`,
  erase: `Dileu`,
  mode: `Modd y brwsh`,
  size: `Maint y brwsh`,
  stop: `Stopio peintio`,
  layer: (name: string) => `Brwsh ar ${name}`,
  help: `Llusgwch ar y llun i beintio. Daliwch Alt i ddileu am eiliad. Pwyswch [ neu ] i newid y maint. Gyda'r bysellfwrdd, mae'r bysellau saeth yn symud y brwsh ac mae Bylchwr yn peintio.`,
  painting: (name: string) => `Yn peintio ar ${name}. Mae ei addasiadau'n gweithio lle rydych yn peintio.`,
  erasing: (name: string) => `Yn dileu o ${name}. Mae ei addasiadau'n peidio lle rydych yn dileu.`,
  added: `Masg brwsh wedi'i ychwanegu. Llusgwch ar y llun i beintio lle mae ei addasiadau i weithio.`,
  pickMask: `Agorwch fasg brwsh, gwrthrych neu gefndir yn y rhestr isod, yna peintiwch ar y llun i ychwanegu ato neu ddileu ohono.`,
  refine: `Mae'r brwsh a'r rhwbiwr hefyd yn mireinio masg gwrthrych neu gefndir: agorwch ef yn y rhestr, yna peintiwch i ychwanegu neu dilëwch i dynnu.`,
  full: (n: number) => `Mae gan y masg hwn ${n} strôc brwsh yn barod, yr uchafswm. Ychwanegwch fasg brwsh arall i ddal ati i beintio.`,
  strokes: (n: number) => plural(n, { one: `${n} strôc brwsh`, other: `${n} strôc brwsh` }),
  unavailable: `Rhagolwg yw peintio. Trowch Brwsh masg ymlaen yn Nodweddion rhagolwg i'w ddefnyddio.`,
};
