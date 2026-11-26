import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  menu: (n: number) => `Sameina ${n} myndir í HDR`,
  menuHint: "Sameinar röð dekkri og ljósari mynda í nýja 16 bita mynd sem heldur björtu og dökku svæðunum. Frumritunum er ekki breytt.",
  task: (n: number) => `Sameinar ${n} myndir í HDR`,
  reading: "Les myndirnar",
  aligning: "Stillir myndirnar saman",
  merging: "Sameinar lýsingarnar",
  saving: "Bætir HDR-myndinni við",
  done: (name: string, n: number) => `${name} bætt við, sameinuð úr ${n} myndum. Upprunalegu myndirnar þínar eru óbreyttar.`,
  cancelled: "HDR-sameining stöðvuð. Engu var bætt við. Upprunalegu myndirnar þínar eru óbreyttar.",
  failed: "HDR-sameiningu lauk ekki. Opnaðu Verk til að sjá ástæðuna. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooFew: "Veldu að minnsta kosti tvær myndir af sama myndefni, teknar dekkri og ljósari, til að sameina í HDR. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooMany: (max: number) => `Veldu í mesta lagi ${max} myndir í einu til að sameina í HDR. Upprunalegu myndirnar þínar eru óbreyttar.`,
  sizeMismatch: "Myndirnar eru misstórar og því er ekki hægt að stilla þær saman. Upprunalegu myndirnar þínar eru óbreyttar.",
  sameExposure: "Myndirnar virðast hafa sömu lýsingu, svo það er ekkert að sameina. Veldu röð sem var tekin dekkri og ljósari. Upprunalegu myndirnar þínar eru óbreyttar.",
  unrelated: (n: number) => `Ekki er hægt að stilla mynd ${n} nógu skýrt saman við hinar, svo engu var sameinað í stað þess að giska. Veldu myndir úr einni röð. Upprunalegu myndirnar þínar eru óbreyttar.`,
  unsupported: (name: string) => `Ekki er hægt að lesa ${name} í fullri stærð hér, svo engu var sameinað. Minni mynd var ekki notuð í staðinn. Upprunalegu myndirnar þínar eru óbreyttar.`,
  rawNotDeveloped: (name: string) => `Ekki var hægt að framkalla ${name} í 16 bitum úr gögnum myndflögunnar hér, og litla innbyggða forskoðun myndavélarinnar er ekki notuð fyrir HDR. Tengdu frumritið aftur og reyndu aftur. Upprunalegu myndirnar þínar eru óbreyttar.`,
  tooLarge: "Myndirnar eru of stórar til að sameina þær á öruggan hátt á þessu tæki. Engu var sameinað. Upprunalegu myndirnar þínar eru óbreyttar.",
  ghostsRemoved: "Eitthvað hreyfðist á milli myndanna. Þar notar sameiningin aðeins eina mynd, svo ekkert birtist tvisvar.",
  highlightsClipped: "Sum björt svæði voru of björt jafnvel í dekkstu myndinni, svo þau haldast hvít.",
  mainThread: "Það keyrði í forgrunni því bakgrunnsvinnsla er ekki í boði hér, svo forritið gæti hafa hikstað á meðan.",
  infoTitle: "HDR-sameining",
  infoMadeFrom: (n: number) => plural(n, { one: `Gerð úr ${n} mynd:`, other: `Gerð úr ${n} myndum:` }),
  infoExposure: (name: string, ev: string) => `${name}: ${ev} stopp`,
  infoHow: "Hver hluti kemur úr myndunum sem voru vel lýstar þar, samstilltar og vegnar eftir lýsingu, og síðan stilltar með Björtu svæðum og Skuggum ritilsins. Engir dílar voru búnir til.",
  whatIs: "HDR merkir mikið birtusvið, ekki mikla upplausn. Það sameinar nokkrar lýsingar af sama myndefni svo bjartur himinn og dökkir skuggar halda báðir smáatriðum.",
  bracketTitle: "Lýsingarröð",
  bracketFound: (n: number, stops: string) => `${n} myndir teknar með augnabliks millibili á mismunandi lýsingu (${stops} stopp).`,
  bracketFromCamera: "Myndavélin þín merkti þessar myndir sem lýsingarröð.",
  bracketFromExposures: "Fundnar út frá lokuhraða, ljósopi og ISO.",
};
