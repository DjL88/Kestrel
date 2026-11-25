import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic (þú). DRAFT: written without a native speaker's check. */
export const is: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Hvítjöfnun', temperature: 'Litahiti', tint: 'Litblær', exposure: 'Lýsing', contrast: 'Birtuskil',
    highlights: 'Ljósir tónar', shadows: 'Skuggar', whites: 'Hvítir', blacks: 'Svartir', toneCurve: 'Tónferill',
    vibrance: 'Litagleði', saturation: 'Litmettun', colourMixer: 'Litablandari', clarity: 'Skýrleiki', detailRecovery: 'Áferð',
    sharpen: 'Skerpa', denoiseLuminance: 'Birtusuð', denoiseColour: 'Litasuð', upscaleFactor: 'Stækkun',
    masks: 'Staðbundnar stillingar',
  },
  notMeasured: 'Ekki mælt',
  notRecorded: 'Ekki skráð',
  suggestedName: (name) => `${name} (tillaga)`,
  subjectKinds: { wildlife: 'Villt dýr', people: 'Fólk', landscape: 'Landslag', other: 'Annað myndefni' },
  auto: {
    ready: 'Yfirfarnar tillögur að breytingum eru tilbúnar til forskoðunar.',
    noneDifferent: 'Engin sjáanlega önnur breyting stóðst prófanirnar.',
    appliedGentler: 'Sjálfvirkt notaði mildari útgáfu: full útgáfa stóðst ekki öryggisprófun.',
    applied: 'Sjálfvirkt notað. Dragðu styrkinn eftir smekk, eða afturkallaðu.',
    looksGood: 'Lítur vel út: mæld gildi eru innan marka, svo engu var breytt.',
    cannotImprove: 'Ekki er hægt að bæta þetta á öruggan hátt, svo engu var breytt.',
    withheld: 'Tillögu að breytingu var haldið aftur af því að hún stóðst ekki prófun.',
    multipleSubjects: 'Hvert myndefni var prófað sér fyrir töpuðum ljósum tónum og skuggum. Litaleiðréttingu eftir tegund var haldið aftur.',
    coverageUnavailable: 'Ekki var hægt að afmarka hvert myndefni, svo aðeins tillögur fyrir alla myndina komu til greina.',
    speciesReference: (features) => `Viðmið tegundar (leiðbeining, ekki mældur litur): ${features}`,
  },
  deepReview: {
    none: 'Ítarleg yfirferð: ekkert myndefni sem greinirinn treystir fannst á þessari mynd.',
    confidence: { high: 'mikilli', medium: 'miðlungs', low: 'lítilli' },
    sharpness: { subjectSharp: 'skarpt', subjectOk: 'nokkuð skarpt', subjectSoft: 'óskýrt', noSubject: 'óljóst', unavailable: 'óljóst' },
    trusted: (confidence, sharpness) => `Ítarleg yfirferð: fann myndefni sem er ${sharpness}, með ${confidence} vissu.`,
    untrusted: (sharpness) => `Ítarleg yfirferð: fann myndefni sem er of ${sharpness} til að treysta.`,
    witness: { bird: 'fugl', aircraft: 'flugvél', person: 'manneskja', animal: 'dýr', vehicle: 'farartæki' },
    agreed: (subject) => `Lestur senunnar staðfestir: ${subject}.`,
    conflict: (reading, detector) => `Lestur senunnar er ósammála: hann segir ${reading}, greinirinn segir ${detector}. Líttu á þetta sem óleyst.`,
    suggested: (name, description) => `Tillaga: „${name}“ – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Ekkert sjáanlegt suð fannst í fullri stærð, svo engu var breytt.',
    protectionLost: 'Ekki tókst að verja myndefnið á öruggan hátt í þetta sinn. Núverandi breytingum þínum var haldið.',
    cloud: 'Suð fjarlægt í InFlight-skýinu úr vinnuafriti og prófað á þessu tæki.',
    cloudNotUsed: 'Skýið var ekki notað í þetta sinn, svo þetta keyrði á þessu tæki.',
    device: 'Suð fjarlægt á þessu tæki.',
    layersFull: 'Ekki gat hvert myndefni fengið eigið lag, svo eitt sameiginlegt varnarlag var notað.',
    protected: (count) => (count === 1
      ? 'Suð fjarlægt á þessu tæki, með myndefnið varið.'
      : `Suð fjarlægt á þessu tæki, með ${count} myndefni varin saman.`),
    global: 'Engin útlína myndefnis var áreiðanleg, svo suðeyðing var notuð jafnt á alla myndina.',
    failedCheck: 'Niðurstaðan stóðst ekki gæðaprófun. Núverandi breytingum þínum var haldið.',
    leftAsItWas: (notes) => `Látið óbreytt. ${notes}`,
  },
};
