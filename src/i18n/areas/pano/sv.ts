import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  menu: (n: number) => `Sätt ihop ${n} bilder till ett panorama`,
  menuHint: "Sätter ihop överlappande bilder till en ny bred bild, beskuren till verkliga pixlar. Originalen ändras inte.",
  task: (n: number) => `Sätter ihop ett panorama av ${n} bilder`,
  reading: "Läser bilderna",
  matching: "Letar efter var bilderna överlappar",
  placing: "Placerar bilderna",
  blending: "Blandar skarvarna",
  saving: "Lägger till panoramat",
  done: (name: string, n: number) => `${name} har lagts till, ihopsatt av ${n} bilder. Dina originalbilder är orörda.`,
  cropNote: (percent: number) => `Beskuren till de ${percent} % av den ihopsatta ytan som verkliga pixlar täcker. Inget fylldes i.`,
  cancelled: "Ihopsättningen stoppades. Inget lades till. Dina originalbilder är orörda.",
  failed: "Panoramat blev inte klart. Öppna Uppgifter för att se varför. Dina originalbilder är orörda.",
  tooFew: "Välj minst två bilder som överlappar. Dina originalbilder är orörda.",
  tooMany: (max: number) => `Välj högst ${max} bilder åt gången. Dina originalbilder är orörda.`,
  sizeMismatch: "Bilderna har olika storlek, så de sattes inte ihop. Dina originalbilder är orörda.",
  tooFlat: (n: number) => `Bild ${n} har för lite detaljer för att riktas in, så inget sattes ihop i stället för att gissa. Dina originalbilder är orörda.`,
  unrelated: (n: number) => `Bild ${n} överlappar inte föregående bild tillräckligt för att rikta in dem, så inget sattes ihop. Välj bilderna i den ordning du tog dem, var och en med ungefär en tredjedel överlapp. Dina originalbilder är orörda.`,
  ambiguous: (n: number) => `Det är oklart var bild ${n} möter föregående bild. Mönstret upprepas, eller kameran lutade för mycket, så inget sattes ihop i stället för att gissa. Dina originalbilder är orörda.`,
  vertical: "Bilderna går uppåt och nedåt i stället för åt sidan. Lodräta panoraman stöds inte ännu, så inget sattes ihop. Dina originalbilder är orörda.",
  tooLarge: "Panoramat skulle bli för stort för att göras säkert på den här enheten, och det görs inte mindre utan att fråga. Välj färre bilder. Dina originalbilder är orörda.",
  noCoverage: "Bilderna lämnar ingen rektangel täckt av verkliga pixlar, så inget sattes ihop i stället för att fylla luckor. Dina originalbilder är orörda.",
  unsupported: (name: string) => `${name} kan inte läsas i full storlek här, så inget sattes ihop. Ingen mindre bild användes i stället. Dina originalbilder är orörda.`,
  rawNotDeveloped: (name: string) => `${name} har ännu ingen framkallning i full storlek från sensordata, och kamerans lilla inbäddade förhandsvisning används inte för panoraman. Gör först framkallningen i full storlek. Dina originalbilder är orörda.`,
  exposureDiffers: "Bilderna togs med ganska olika ljusstyrka. De har jämnats ut, men kontrollera himlen efter ränder.",
  seamsVisible: "Vissa skarvar kan synas: något rörde sig mellan bilderna, eller kameran flyttades i stället för att vridas.",
  focalEstimated: "Objektivets brännvidd fanns inte sparad, så den räknades fram ur bilderna.",
  mainThread: "Det kördes i förgrunden eftersom bakgrundsarbete inte finns här, så appen kan ha hackat under tiden.",
  infoTitle: "Panorama",
  infoMadeFrom: (n: number) => plural(n, { one: `Ihopsatt av ${n} bild:`, other: `Ihopsatt av ${n} bilder:` }),
  infoHow: "Lagda på en cylinder, skarvar mjukt blandade och beskuren till verkliga pixlar. Inga pixlar skapades.",
};
