import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. */
export const sv: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Vitbalans', temperature: 'Temperatur', tint: 'Färgton', exposure: 'Exponering', contrast: 'Kontrast',
    highlights: 'Högdagrar', shadows: 'Skuggor', whites: 'Vita', blacks: 'Svarta', toneCurve: 'Tonkurva',
    vibrance: 'Lyster', saturation: 'Mättnad', colourMixer: 'Färgmixer', clarity: 'Klarhet', detailRecovery: 'Textur',
    sharpen: 'Skärpa', denoiseLuminance: 'Luminansbrus', denoiseColour: 'Färgbrus', upscaleFactor: 'Uppskalning',
    masks: 'Lokala justeringar',
  },
  notMeasured: 'Inte mätt',
  notRecorded: 'Inte registrerat',
  suggestedName: (name) => `${name} (förslag)`,
  subjectKinds: { wildlife: 'Vilda djur', people: 'Människor', landscape: 'Landskap', other: 'Annat motiv' },
  auto: {
    ready: 'Kontrollerade redigeringsförslag är redo att förhandsvisas.',
    noneDifferent: 'Ingen synligt annorlunda redigering klarade kontrollerna.',
    appliedGentler: 'Auto använde en mildare version: den fullständiga klarade inte en säkerhetskontroll.',
    applied: 'Auto tillämpat. Dra styrkan efter smak, eller ångra.',
    looksGood: 'Ser bra ut: de uppmätta värdena ligger inom intervallet, så inget ändrades.',
    cannotImprove: 'Det går inte att förbättra säkert, så inget ändrades.',
    withheld: 'Ett redigeringsförslag hölls tillbaka eftersom det inte klarade en kontroll.',
    multipleSubjects: 'Varje motiv kontrollerades för sig för förlorade högdagrar och skuggor. Färgkorrigering efter art hölls tillbaka.',
    coverageUnavailable: 'Alla motiv kunde inte avgränsas, så bara förslag för hela fotot övervägdes.',
    speciesReference: (features) => `Artreferens (en vägledning, inte en uppmätt färg): ${features}`,
  },
  deepReview: {
    none: 'Djupgranskning: inget motiv som detektorn litar på hittades i det här fotot.',
    confidence: { high: 'hög', medium: 'medel', low: 'låg' },
    sharpness: { subjectSharp: 'skarpt', subjectOk: 'ganska skarpt', subjectSoft: 'oskarpt', noSubject: 'oklart', unavailable: 'oklart' },
    trusted: (confidence, sharpness) => `Djupgranskning: hittade ett ${sharpness} motiv med ${confidence} säkerhet.`,
    untrusted: (sharpness) => `Djupgranskning: hittade ett motiv som är för ${sharpness} för att lita på.`,
    witness: { bird: 'fågel', aircraft: 'flygplan', person: 'person', animal: 'djur', vehicle: 'fordon' },
    agreed: (subject) => `Scentolkningen bekräftar: ${subject}.`,
    conflict: (reading, detector) => `Scentolkningen håller inte med: den säger ${reading}, detektorn säger ${detector}. Se det som olöst.`,
    suggested: (name, description) => `Förslag: ”${name}” – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Inget synligt brus hittades i full storlek, så inget ändrades.',
    protectionLost: 'Motivet kunde inte skyddas säkert den här gången. Dina befintliga redigeringar behölls.',
    cloud: 'Brusreducerat i InFlight-molnet från en arbetskopia och kontrollerat på den här enheten.',
    cloudNotUsed: 'Molnet användes inte den här gången, så det kördes på den här enheten.',
    device: 'Brusreducerat på den här enheten.',
    layersFull: 'Alla motiv kunde inte få ett eget lager, så ett gemensamt skyddslager användes.',
    protected: (count) => (count === 1
      ? 'Brusreducerat på den här enheten, med motivet skyddat.'
      : `Brusreducerat på den här enheten, med ${count} motiv skyddade tillsammans.`),
    global: 'Ingen motivkontur var tillförlitlig, så brusreduceringen tillämpades jämnt på hela fotot.',
    failedCheck: 'Resultatet klarade inte kvalitetskontrollen. Dina befintliga redigeringar behölls.',
    leftAsItWas: (notes) => `Lämnat som det var. ${notes}`,
  },
};
