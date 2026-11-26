import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  menu: (n: number) => `Slå ihop ${n} bilder till HDR`,
  menuHint: "Slår ihop en serie mörkare och ljusare bilder till en ny 16-bitarsbild som behåller högdagrar och skuggor. Originalen ändras inte.",
  task: (n: number) => `Slår ihop ${n} bilder till HDR`,
  reading: "Läser bilderna",
  aligning: "Riktar in bilderna",
  merging: "Slår ihop exponeringarna",
  saving: "Lägger till HDR-bilden",
  done: (name: string, n: number) => `${name} har lagts till, ihopslagen av ${n} bilder. Dina originalbilder är orörda.`,
  cancelled: "HDR-sammanslagningen stoppades. Inget lades till. Dina originalbilder är orörda.",
  failed: "HDR-sammanslagningen blev inte klar. Öppna Uppgifter för att se varför. Dina originalbilder är orörda.",
  tooFew: "Välj minst två bilder av samma motiv, tagna mörkare och ljusare, för att slå ihop till HDR. Dina originalbilder är orörda.",
  tooMany: (max: number) => `Välj högst ${max} bilder åt gången för att slå ihop till HDR. Dina originalbilder är orörda.`,
  sizeMismatch: "Bilderna har olika storlek och kan därför inte riktas in. Dina originalbilder är orörda.",
  sameExposure: "Bilderna verkar ha samma exponering, så det finns inget att slå ihop. Välj en serie tagen mörkare och ljusare. Dina originalbilder är orörda.",
  unrelated: (n: number) => `Bild ${n} går inte att rikta in tydligt nog mot de andra, så inget slogs ihop i stället för att gissa. Välj bilder från en serie. Dina originalbilder är orörda.`,
  unsupported: (name: string) => `${name} kan inte läsas i full storlek här, så inget slogs ihop. Ingen mindre bild användes i stället. Dina originalbilder är orörda.`,
  rawNotDeveloped: (name: string) => `${name} kunde inte framkallas i 16 bitar från sensordata här, och kamerans lilla inbäddade förhandsvisning används inte för HDR. Anslut originalet igen och försök på nytt. Dina originalbilder är orörda.`,
  tooLarge: "Bilderna är för stora för att slås ihop säkert på den här enheten. Inget slogs ihop. Dina originalbilder är orörda.",
  ghostsRemoved: "Något rörde sig mellan bilderna. Där använder sammanslagningen bara en bild, så att inget syns två gånger.",
  highlightsClipped: "Vissa högdagrar var för ljusa även i den mörkaste bilden, så de förblir vita.",
  mainThread: "Det kördes i förgrunden eftersom bakgrundsarbete inte finns här, så appen kan ha hackat under tiden.",
  infoTitle: "HDR-sammanslagning",
  infoMadeFrom: (n: number) => plural(n, { one: `Gjord av ${n} bild:`, other: `Gjord av ${n} bilder:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} steg`,
  infoHow: "Varje del kommer från de bilder som var väl exponerade där, inriktade och viktade efter exponering, och sedan justerade med redigerarens Högdagrar och Skuggor. Inga pixlar skapades.",
};
