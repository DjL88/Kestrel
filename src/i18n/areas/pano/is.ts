import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  menu: (n: number) => `Skeyta ${n} myndum saman í víðmynd`,
  menuHint: "Skeytir myndum sem skarast saman í eina nýja breiða mynd, skorna að raunverulegum dílum. Frumritunum er ekki breytt.",
  task: (n: number) => `Skeytir víðmynd úr ${n} myndum`,
  reading: "Les myndirnar",
  matching: "Finnur hvar myndirnar skarast",
  placing: "Raðar myndunum",
  blending: "Blandar samskeytin",
  saving: "Bætir víðmyndinni við",
  done: (name: string, n: number) => `${name} bætt við, skeytt saman úr ${n} myndum. Upprunalegu myndirnar þínar eru óbreyttar.`,
  cropNote: (percent: number) => `Skorin að þeim ${percent}% svæðisins sem raunverulegir dílar þekja. Engu var bætt inn.`,
  cancelled: "Skeytingin var stöðvuð. Engu var bætt við. Upprunalegu myndirnar þínar eru óbreyttar.",
  failed: "Víðmyndin kláraðist ekki. Opnaðu Verk til að sjá ástæðuna. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooFew: "Veldu minnst tvær myndir sem skarast. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooMany: (max: number) => `Veldu í mesta lagi ${max} myndir í einu. Upprunalegu myndirnar þínar eru óbreyttar.`,
  sizeMismatch: "Myndirnar eru misstórar, svo þeim var ekki skeytt saman. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooFlat: (n: number) => `Mynd ${n} hefur of lítil smáatriði til að stilla hana af, svo engu var skeytt saman í stað þess að giska. Upprunalegu myndirnar þínar eru óbreyttar.`,
  unrelated: (n: number) => `Mynd ${n} skarast ekki nóg við fyrri mynd til að stilla þær af, svo engu var skeytt saman. Veldu myndirnar í þeirri röð sem þú tókst þær, hverja með um þriðjungs skörun. Upprunalegu myndirnar þínar eru óbreyttar.`,
  ambiguous: (n: number) => `Óljóst er hvar mynd ${n} mætir fyrri mynd. Mynstrið endurtekur sig eða myndavélin hallaði of mikið, svo engu var skeytt saman í stað þess að giska. Upprunalegu myndirnar þínar eru óbreyttar.`,
  vertical: "Myndirnar liggja upp og niður en ekki til hliðar. Lóðréttar víðmyndir eru ekki studdar enn, svo engu var skeytt saman. Upprunalegu myndirnar þínar eru óbreyttar.",
  tooLarge: "Víðmyndin yrði of stór til að gera hana á öruggan hátt á þessu tæki og hún er ekki minnkuð án þess að spyrja. Veldu færri myndir. Upprunalegu myndirnar þínar eru óbreyttar.",
  noCoverage: "Myndirnar skilja ekki eftir rétthyrning sem raunverulegir dílar þekja, svo engu var skeytt saman í stað þess að fylla í göt. Upprunalegu myndirnar þínar eru óbreyttar.",
  unsupported: (name: string) => `Ekki er hægt að lesa ${name} í fullri stærð hér, svo engu var skeytt saman. Minni mynd var ekki notuð í staðinn. Upprunalegu myndirnar þínar eru óbreyttar.`,
  rawNotDeveloped: (name: string) => `${name} hefur enn enga framköllun í fullri stærð úr skynjaragögnunum og litla innbyggða forskoðun myndavélarinnar er ekki notuð í víðmyndir. Gerðu fyrst framköllun í fullri stærð. Upprunalegu myndirnar þínar eru óbreyttar.`,
  exposureDiffers: "Myndirnar voru teknar með talsvert ólíkri birtu. Þær voru jafnaðar, en athugaðu hvort rendur sjáist á himninum.",
  seamsVisible: "Sum samskeyti gætu sést: eitthvað hreyfðist á milli mynda, eða myndavélin færðist í stað þess að snúast.",
  focalEstimated: "Brennivídd linsunnar var ekki skráð, svo hún var reiknuð út frá myndunum.",
  mainThread: "Það keyrði í forgrunni því bakgrunnsvinnsla er ekki í boði hér, svo forritið gæti hafa hikstað á meðan.",
  infoTitle: "Víðmynd",
  infoMadeFrom: (n: number) => plural(n, { one: `Skeytt saman úr ${n} mynd:`, other: `Skeytt saman úr ${n} myndum:` }),
  infoHow: "Lagðar á sívalning, samskeyti blönduð mjúklega og skorin að raunverulegum dílum. Engir dílar voru búnir til.",
};
