import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian bokmål. DRAFT: written without a native speaker's check. */
export const nb: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Hvitbalanse', temperature: 'Temperatur', tint: 'Fargetone', exposure: 'Eksponering', contrast: 'Kontrast',
    highlights: 'Høylys', shadows: 'Skygger', whites: 'Hvite', blacks: 'Svarte', toneCurve: 'Tonekurve',
    vibrance: 'Livfullhet', saturation: 'Metning', colourMixer: 'Fargemikser', clarity: 'Klarhet', detailRecovery: 'Tekstur',
    sharpen: 'Skarphet', denoiseLuminance: 'Luminansstøy', denoiseColour: 'Fargestøy', upscaleFactor: 'Oppskalering',
    masks: 'Lokale justeringer',
  },
  notMeasured: 'Ikke målt',
  notRecorded: 'Ikke registrert',
  suggestedName: (name) => `${name} (forslag)`,
  subjectKinds: { wildlife: 'Dyreliv', people: 'Mennesker', landscape: 'Landskap', other: 'Annet motiv' },
  auto: {
    ready: 'Kontrollerte redigeringsforslag er klare til forhåndsvisning.',
    noneDifferent: 'Ingen synlig annerledes redigering besto kontrollene.',
    appliedGentler: 'Auto brukte en mildere versjon: den fulle versjonen strøk på en sikkerhetskontroll.',
    applied: 'Auto brukt. Dra styrken etter smak, eller angre.',
    looksGood: 'Ser bra ut: de målte verdiene er innenfor området, så ingenting ble endret.',
    cannotImprove: 'Dette kan ikke forbedres trygt, så ingenting ble endret.',
    withheld: 'Et redigeringsforslag ble holdt tilbake fordi det strøk på en kontroll.',
    multipleSubjects: 'Hvert motiv ble kontrollert for seg for tapt høylys og tapte skygger. Fargekorrigering etter art ble holdt tilbake.',
    coverageUnavailable: 'Ikke alle motiver kunne avgrenses, så bare forslag for hele bildet ble vurdert.',
    speciesReference: (features) => `Artsreferanse (en rettesnor, ikke en målt farge): ${features}`,
  },
  deepReview: {
    none: 'Dybdegjennomgang: fant ikke noe motiv detektoren stoler på i dette bildet.',
    confidence: { high: 'høy', medium: 'middels', low: 'lav' },
    sharpness: { subjectSharp: 'skarpt', subjectOk: 'ganske skarpt', subjectSoft: 'uskarpt', noSubject: 'uklart', unavailable: 'uklart' },
    trusted: (confidence, sharpness) => `Dybdegjennomgang: fant et ${sharpness} motiv med ${confidence} sikkerhet.`,
    untrusted: (sharpness) => `Dybdegjennomgang: fant et motiv som er for ${sharpness} til å stole på.`,
    witness: { bird: 'fugl', aircraft: 'fly', person: 'person', animal: 'dyr', vehicle: 'kjøretøy' },
    agreed: (subject) => `Scenetolkningen bekrefter: ${subject}.`,
    conflict: (reading, detector) => `Scenetolkningen er uenig: den sier ${reading}, detektoren sier ${detector}. Regn dette som uavklart.`,
    suggested: (name, description) => `Forslag: «${name}» – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Fant ingen synlig støy i full størrelse, så ingenting ble endret.',
    protectionLost: 'Motivet kunne ikke beskyttes trygt denne gangen. De eksisterende redigeringene dine ble beholdt.',
    cloud: 'Støy fjernet i InFlight-skyen fra en arbeidskopi og kontrollert på denne enheten.',
    cloudNotUsed: 'Skyen ble ikke brukt denne gangen, så det kjørte på denne enheten.',
    device: 'Støy fjernet på denne enheten.',
    layersFull: 'Ikke alle motiver kunne få sitt eget lag, så ett felles beskyttelseslag ble brukt.',
    protected: (count) => (count === 1
      ? 'Støy fjernet på denne enheten, med motivet beskyttet.'
      : `Støy fjernet på denne enheten, med ${count} motiver beskyttet sammen.`),
    global: 'Ingen motivkontur var pålitelig, så støyreduksjonen ble brukt jevnt på hele bildet.',
    failedCheck: 'Resultatet besto ikke kvalitetskontrollen. De eksisterende redigeringene dine ble beholdt.',
    leftAsItWas: (notes) => `Latt være som det var. ${notes}`,
  },
};
