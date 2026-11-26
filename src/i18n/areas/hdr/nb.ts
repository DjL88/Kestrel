import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  menu: (n: number) => `Slå sammen ${n} bilder til HDR`,
  menuHint: "Slår sammen en serie mørkere og lysere bilder til et nytt 16-biters bilde som tar vare på høylys og skygger. Originalene endres ikke.",
  task: (n: number) => `Slår sammen ${n} bilder til HDR`,
  reading: "Leser bildene",
  aligning: "Retter inn bildene",
  merging: "Slår sammen eksponeringene",
  saving: "Legger til HDR-bildet",
  done: (name: string, n: number) => `${name} er lagt til, slått sammen av ${n} bilder. De originale bildene dine er urørte.`,
  cancelled: "HDR-sammenslåingen ble stoppet. Ingenting ble lagt til. De originale bildene dine er urørte.",
  failed: "HDR-sammenslåingen ble ikke ferdig. Åpne Oppgaver for å se årsaken. De originale bildene dine er urørte.",
  tooFew: "Velg minst to bilder av samme motiv, tatt mørkere og lysere, for å slå sammen til HDR. De originale bildene dine er urørte.",
  tooMany: (max: number) => `Velg høyst ${max} bilder om gangen for å slå sammen til HDR. De originale bildene dine er urørte.`,
  sizeMismatch: "Bildene har ulik størrelse og kan derfor ikke rettes inn. De originale bildene dine er urørte.",
  sameExposure: "Bildene ser ut til å ha samme eksponering, så det er ingenting å slå sammen. Velg en serie tatt mørkere og lysere. De originale bildene dine er urørte.",
  unrelated: (n: number) => `Bilde ${n} kan ikke rettes tydelig nok inn mot de andre, så ingenting ble slått sammen i stedet for å gjette. Velg bilder fra én serie. De originale bildene dine er urørte.`,
  unsupported: (name: string) => `${name} kan ikke leses i full størrelse her, så ingenting ble slått sammen. Det ble ikke brukt et mindre bilde i stedet. De originale bildene dine er urørte.`,
  rawNotDeveloped: (name: string) => `${name} kunne ikke fremkalles i 16 biter fra sensordataene her, og kameraets lille innebygde forhåndsvisning brukes ikke til HDR. Koble til originalen igjen og prøv på nytt. De originale bildene dine er urørte.`,
  tooLarge: "Bildene er for store til å slås sammen trygt på denne enheten. Ingenting ble slått sammen. De originale bildene dine er urørte.",
  ghostsRemoved: "Noe beveget seg mellom bildene. Der bruker sammenslåingen bare ett bilde, så ingenting vises to ganger.",
  highlightsClipped: "Noe høylys var for lyst selv i det mørkeste bildet, så det forblir hvitt.",
  mainThread: "Det kjørte i forgrunnen fordi bakgrunnsarbeid ikke er tilgjengelig her, så appen kan ha hakket underveis.",
  infoTitle: "HDR-sammenslåing",
  infoMadeFrom: (n: number) => plural(n, { one: `Laget av ${n} bilde:`, other: `Laget av ${n} bilder:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} trinn`,
  infoHow: "Hver del kommer fra bildene som var godt eksponert der, rettet inn og vektet etter eksponering, og deretter justert med redigeringens Høylys og Skygger. Ingen piksler ble generert.",
  whatIs: "HDR betyr høyt dynamisk område, ikke høy oppløsning. Det slår sammen flere eksponeringer av samme motiv, så lys himmel og mørke skygger begge beholder detaljene.",
  bracketTitle: "Eksponeringsserie",
  bracketFound: (n: number, stops: string) => `${n} bilder tatt like etter hverandre med ulik eksponering (${stops} trinn).`,
  bracketFromCamera: "Kameraet ditt merket bildene som en eksponeringsserie.",
  bracketFromExposures: "Funnet ut fra lukkertid, blender og ISO.",
};
