import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fokusstapla ${n} bilder`,
  menuHint: "Sätter ihop de skarpaste delarna av varje bild till en ny bild. Originalen ändras inte.",
  task: (n: number) => `Fokusstaplar ${n} bilder`,
  reading: "Läser bilderna",
  aligning: "Riktar in bilderna",
  blending: "Sätter ihop de skarpaste delarna",
  saving: "Lägger till den staplade bilden",
  done: (name: string, n: number) => `${name} har lagts till, staplad av ${n} bilder. Dina originalbilder är orörda.`,
  cancelled: "Fokusstaplingen stoppades. Inget lades till. Dina originalbilder är orörda.",
  failed: "Fokusstaplingen blev inte klar. Öppna Uppgifter för att se varför. Dina originalbilder är orörda.",
  tooFew: "Välj minst två bilder av samma motiv. Dina originalbilder är orörda.",
  tooMany: (max: number) => `Välj högst ${max} bilder åt gången. Dina originalbilder är orörda.`,
  sizeMismatch: "Bilderna har olika storlek och kan därför inte riktas in. Dina originalbilder är orörda.",
  unrelated: (n: number) => `Bild ${n} verkar inte visa samma motiv som grannen, så inget staplades. Välj bilder ur samma serie. Dina originalbilder är orörda.`,
  ambiguous: (n: number) => `Det är oklart hur bild ${n} passar mot grannen (mönstret upprepas eller den rörde sig för mycket), så inget staplades i stället för att gissa. Dina originalbilder är orörda.`,
  tooFlat: (n: number) => `Bild ${n} har för lite detaljer för att riktas in, så inget staplades i stället för att gissa. Dina originalbilder är orörda.`,
  unsupported: (name: string) => `${name} kan inte läsas i full storlek här, så inget staplades. Ingen mindre bild användes i stället. Dina originalbilder är orörda.`,
  rawNotDeveloped: (name: string) => `${name} har ännu ingen framkallning i full storlek från sensordata, och kamerans lilla inbäddade förhandsvisning används inte. Gör först framkallningen i full storlek. Dina originalbilder är orörda.`,
  tooLarge: "Bilderna är för stora för att staplas säkert på den här enheten. Inget staplades. Dina originalbilder är orörda.",
  equallySharp: "Bilderna ser lika skarpa ut överallt, så stapeln kan likna originalen mycket.",
  frameUnused: (n: number) => `Bild ${n} bidrog med nästan ingenting.`,
  oneFrameDominates: "En bild stod för nästan alla detaljer. Kontrollera att bilderna togs på olika fokusavstånd.",
  localFallback: (n: number) => `Bild ${n} riktades bara in som helhet: för lite matchande detaljer för finare inriktning.`,
  mainThread: "Det kördes i förgrunden eftersom bakgrundsarbete inte finns här, så appen kan ha hackat under tiden.",
  infoTitle: "Fokusstapel",
  infoMadeFrom: (n: number) => plural(n, { one: `Gjord av ${n} bild:`, other: `Gjord av ${n} bilder:` }),
  infoHow: "Varje del kommer från den skarpaste bilden just där, mjukt sammanfogad. Inga pixlar skapades.",
};
