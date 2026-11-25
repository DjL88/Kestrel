import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fokusstable ${n} bilder`,
  menuHint: "Setter sammen de skarpeste delene av hvert bilde til et nytt bilde. Originalene endres ikke.",
  task: (n: number) => `Fokusstabler ${n} bilder`,
  reading: "Leser bildene",
  aligning: "Retter inn bildene",
  blending: "Setter sammen de skarpeste delene",
  saving: "Legger til det stablede bildet",
  done: (name: string, n: number) => `${name} er lagt til, stablet av ${n} bilder. De originale bildene dine er urørte.`,
  cancelled: "Fokusstablingen ble stoppet. Ingenting ble lagt til. De originale bildene dine er urørte.",
  failed: "Fokusstablingen ble ikke ferdig. Åpne Oppgaver for å se årsaken. De originale bildene dine er urørte.",
  tooFew: "Velg minst to bilder av samme motiv. De originale bildene dine er urørte.",
  tooMany: (max: number) => `Velg høyst ${max} bilder om gangen. De originale bildene dine er urørte.`,
  sizeMismatch: "Bildene har ulik størrelse og kan derfor ikke rettes inn. De originale bildene dine er urørte.",
  unrelated: (n: number) => `Bilde ${n} ser ikke ut til å vise samme motiv som naboen, så ingenting ble stablet. Velg bilder fra én serie. De originale bildene dine er urørte.`,
  ambiguous: (n: number) => `Det er uklart hvordan bilde ${n} passer med naboen (mønsteret gjentar seg, eller det flyttet seg for mye), så ingenting ble stablet i stedet for å gjette. De originale bildene dine er urørte.`,
  tooFlat: (n: number) => `Bilde ${n} har for lite detaljer til å rettes inn, så ingenting ble stablet i stedet for å gjette. De originale bildene dine er urørte.`,
  unsupported: (name: string) => `${name} kan ikke leses i full størrelse her, så ingenting ble stablet. Det ble ikke brukt et mindre bilde i stedet. De originale bildene dine er urørte.`,
  rawNotDeveloped: (name: string) => `${name} har ennå ingen fremkalling i full størrelse fra sensordataene, og kameraets lille innebygde forhåndsvisning brukes ikke. Lag fremkallingen i full størrelse først. De originale bildene dine er urørte.`,
  tooLarge: "Bildene er for store til å stables trygt på denne enheten. Ingenting ble stablet. De originale bildene dine er urørte.",
  equallySharp: "Bildene ser like skarpe ut overalt, så stabelen kan ligne mye på originalene.",
  frameUnused: (n: number) => `Bilde ${n} bidro med nesten ingenting.`,
  oneFrameDominates: "Ett bilde sto for nesten alle detaljene. Sjekk at bildene ble tatt på ulike fokusavstander.",
  localFallback: (n: number) => `Bilde ${n} ble bare rettet inn som helhet: for lite samsvarende detaljer til finere innretting.`,
  infoTitle: "Fokusstabel",
  infoMadeFrom: (n: number) => plural(n, { one: `Laget av ${n} bilde:`, other: `Laget av ${n} bilder:` }),
  infoHow: "Hver del kommer fra det skarpeste bildet akkurat der, mykt blandet. Ingen piksler ble generert.",
};
