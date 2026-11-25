import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. */
export const da: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Hvidbalance', temperature: 'Temperatur', tint: 'Nuance', exposure: 'Eksponering', contrast: 'Kontrast',
    highlights: 'Højlys', shadows: 'Skygger', whites: 'Hvide', blacks: 'Sorte', toneCurve: 'Tonekurve',
    vibrance: 'Livlighed', saturation: 'Mætning', colourMixer: 'Farvemixer', clarity: 'Klarhed', detailRecovery: 'Tekstur',
    sharpen: 'Skarphed', denoiseLuminance: 'Luminansstøj', denoiseColour: 'Farvestøj', upscaleFactor: 'Opskalering',
    masks: 'Lokale justeringer',
  },
  notMeasured: 'Ikke målt',
  notRecorded: 'Ikke registreret',
  suggestedName: (name) => `${name} (forslag)`,
  subjectKinds: { wildlife: 'Vilde dyr', people: 'Mennesker', landscape: 'Landskab', other: 'Andet motiv' },
  auto: {
    ready: 'Kontrollerede redigeringsforslag er klar til visning.',
    noneDifferent: 'Ingen synligt anderledes redigering bestod kontrollerne.',
    appliedGentler: 'Auto brugte en mildere version: den fulde version dumpede et sikkerhedstjek.',
    applied: 'Auto anvendt. Træk styrken efter smag, eller fortryd.',
    looksGood: 'Ser godt ud: de målte værdier ligger inden for området, så intet blev ændret.',
    cannotImprove: 'Det kan ikke forbedres sikkert, så intet blev ændret.',
    withheld: 'Et redigeringsforslag blev holdt tilbage, fordi det dumpede et tjek.',
    multipleSubjects: 'Hvert motiv blev tjekket for sig for tabt højlys og tabte skygger. Farvekorrektion efter art blev holdt tilbage.',
    coverageUnavailable: 'Ikke alle motiver kunne afgrænses, så kun forslag til hele fotoet blev overvejet.',
    speciesReference: (features) => `Artsreference (en rettesnor, ikke en målt farve): ${features}`,
  },
  deepReview: {
    none: 'Dybdegennemgang: der blev ikke fundet et motiv, som detektoren stoler på, i dette foto.',
    confidence: { high: 'høj', medium: 'middel', low: 'lav' },
    sharpness: { subjectSharp: 'skarpt', subjectOk: 'rimelig skarpt', subjectSoft: 'uskarpt', noSubject: 'uklart', unavailable: 'uklart' },
    trusted: (confidence, sharpness) => `Dybdegennemgang: fandt et ${sharpness} motiv med ${confidence} sikkerhed.`,
    untrusted: (sharpness) => `Dybdegennemgang: fandt et motiv, der er for ${sharpness} til at stole på.`,
    witness: { bird: 'fugl', aircraft: 'fly', person: 'person', animal: 'dyr', vehicle: 'køretøj' },
    agreed: (subject) => `Scenegenkendelsen bekræfter: ${subject}.`,
    conflict: (reading, detector) => `Scenegenkendelsen er uenig: den siger ${reading}, detektoren siger ${detector}. Betragt det som uafklaret.`,
    suggested: (name, description) => `Forslag: »${name}« – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Der blev ikke fundet synlig støj i fuld størrelse, så intet blev ændret.',
    protectionLost: 'Motivet kunne ikke beskyttes sikkert denne gang. Dine eksisterende redigeringer blev bevaret.',
    cloud: 'Støj fjernet i InFlight-skyen fra en arbejdskopi og tjekket på denne enhed.',
    cloudNotUsed: 'Skyen blev ikke brugt denne gang, så det kørte på denne enhed.',
    device: 'Støj fjernet på denne enhed.',
    layersFull: 'Ikke alle motiver kunne få deres eget lag, så der blev brugt ét fælles beskyttelseslag.',
    protected: (count) => (count === 1
      ? 'Støj fjernet på denne enhed, med motivet beskyttet.'
      : `Støj fjernet på denne enhed, med ${count} motiver beskyttet sammen.`),
    global: 'Ingen motivkontur var pålidelig, så støjreduktionen blev brugt jævnt på hele fotoet.',
    failedCheck: 'Resultatet bestod ikke kvalitetstjekket. Dine eksisterende redigeringer blev bevaret.',
    leftAsItWas: (notes) => `Ladt som det var. ${notes}`,
  },
};
