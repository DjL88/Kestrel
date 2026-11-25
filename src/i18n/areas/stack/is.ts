import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  menu: (n: number) => `Fókusstafla ${n} myndum`,
  menuHint: "Sameinar skörpustu hluta hverrar myndar í nýja mynd. Frumritunum er ekki breytt.",
  task: (n: number) => `Fókusstaflar ${n} myndum`,
  reading: "Les myndirnar",
  aligning: "Stillir myndirnar saman",
  blending: "Sameinar skörpustu hlutana",
  saving: "Bætir staflaðri mynd við",
  done: (name: string, n: number) => `${name} bætt við, stöfluð úr ${n} myndum. Upprunalegu myndirnar þínar eru óbreyttar.`,
  cancelled: "Fókusstöflun stöðvuð. Engu var bætt við. Upprunalegu myndirnar þínar eru óbreyttar.",
  failed: "Fókusstöflun lauk ekki. Opnaðu Verk til að sjá ástæðuna. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooFew: "Veldu minnst tvær myndir af sama myndefni. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooMany: (max: number) => `Veldu í mesta lagi ${max} myndir í einu. Upprunalegu myndirnar þínar eru óbreyttar.`,
  sizeMismatch: "Myndirnar eru misstórar og því er ekki hægt að stilla þær saman. Upprunalegu myndirnar þínar eru óbreyttar.",
  unrelated: (n: number) => `Mynd ${n} virðist ekki sýna sama myndefni og nágranninn, svo engu var staflað. Veldu myndir úr einni hrinu. Upprunalegu myndirnar þínar eru óbreyttar.`,
  ambiguous: (n: number) => `Óljóst er hvernig mynd ${n} passar við nágrannann (mynstrið endurtekur sig eða hún hreyfðist of mikið), svo engu var staflað frekar en að giska. Upprunalegu myndirnar þínar eru óbreyttar.`,
  tooFlat: (n: number) => `Mynd ${n} hefur of lítið af smáatriðum til að stilla saman, svo engu var staflað frekar en að giska. Upprunalegu myndirnar þínar eru óbreyttar.`,
  unsupported: (name: string) => `Ekki er hægt að lesa ${name} í fullri stærð hér, svo engu var staflað. Minni mynd var ekki notuð í staðinn. Upprunalegu myndirnar þínar eru óbreyttar.`,
  rawNotDeveloped: (name: string) => `${name} hefur enn enga framköllun í fullri stærð úr skynjaragögnunum og litla innbyggða forskoðun myndavélarinnar er ekki notuð. Gerðu fyrst framköllun í fullri stærð. Upprunalegu myndirnar þínar eru óbreyttar.`,
  tooLarge: "Myndirnar eru of stórar til að stafla þeim á öruggan hátt á þessu tæki. Engu var staflað. Upprunalegu myndirnar þínar eru óbreyttar.",
  equallySharp: "Myndirnar virðast jafnskarpar alls staðar, svo staflinn gæti líkst frumritunum mikið.",
  frameUnused: (n: number) => `Mynd ${n} bætti nánast engu við.`,
  oneFrameDominates: "Ein mynd lagði til nánast öll smáatriðin. Athugaðu hvort myndirnar voru teknar í mismunandi fókusfjarlægð.",
  localFallback: (n: number) => `Mynd ${n} var aðeins stillt saman í heild: of lítið af samsvarandi smáatriðum fyrir nákvæmari stillingu.`,
  infoTitle: "Fókusstafli",
  infoMadeFrom: (n: number) => plural(n, { one: `Gerð úr ${n} mynd:`, other: `Gerð úr ${n} myndum:` }),
  infoHow: "Hver hluti kemur úr skörpustu myndinni á þeim stað, mjúklega blandað. Engir dílar voru búnir til.",
};
