import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian (tu). DRAFT: written without a native speaker's check. */
export const it: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Bilanciamento del bianco', temperature: 'Temperatura', tint: 'Tinta', exposure: 'Esposizione', contrast: 'Contrasto',
    highlights: 'Luci', shadows: 'Ombre', whites: 'Bianchi', blacks: 'Neri', toneCurve: 'Curva dei toni',
    vibrance: 'Vividezza', saturation: 'Saturazione', colourMixer: 'Mixer colori', clarity: 'Chiarezza', detailRecovery: 'Texture',
    sharpen: 'Nitidezza', denoiseLuminance: 'Rumore di luminanza', denoiseColour: 'Rumore di colore', upscaleFactor: 'Ingrandimento',
    masks: 'Regolazioni locali',
  },
  notMeasured: 'Non misurato',
  notRecorded: 'Non registrato',
  suggestedName: (name) => `${name} (suggerito)`,
  subjectKinds: { wildlife: 'Fauna', people: 'Persone', landscape: 'Paesaggio', other: 'Altro soggetto' },
  auto: {
    ready: 'Suggerimenti di modifica verificati pronti per l’anteprima.',
    noneDifferent: 'Nessuna modifica visibilmente diversa ha superato i controlli.',
    appliedGentler: 'Auto ha applicato una versione più delicata: quella completa non ha superato un controllo di sicurezza.',
    applied: 'Auto applicato. Regola l’intensità a piacere, oppure annulla.',
    looksGood: 'Va bene così: i valori misurati sono nell’intervallo, quindi non è stato cambiato nulla.',
    cannotImprove: 'Non si può migliorare in sicurezza, quindi non è stato cambiato nulla.',
    withheld: 'Una modifica suggerita è stata trattenuta perché non ha superato un controllo.',
    multipleSubjects: 'Ogni soggetto è stato controllato da solo per luci e ombre perse. La correzione del colore per specie è stata trattenuta.',
    coverageUnavailable: 'Non è stato possibile scontornare ogni soggetto, quindi sono stati considerati solo suggerimenti per tutta la foto.',
    speciesReference: (features) => `Riferimento della specie (una guida, non un colore misurato): ${features}`,
  },
  deepReview: {
    none: 'Revisione approfondita: in questa foto non c’è un soggetto di cui il rilevatore si fidi.',
    confidence: { high: 'alta', medium: 'media', low: 'bassa' },
    sharpness: { subjectSharp: 'nitido', subjectOk: 'abbastanza nitido', subjectSoft: 'sfocato', noSubject: 'incerto', unavailable: 'incerto' },
    trusted: (confidence, sharpness) => `Revisione approfondita: trovato un soggetto ${sharpness}, con fiducia ${confidence}.`,
    untrusted: (sharpness) => `Revisione approfondita: trovato un soggetto troppo ${sharpness} per fidarsi.`,
    witness: { bird: 'uccello', aircraft: 'aereo', person: 'persona', animal: 'animale', vehicle: 'veicolo' },
    agreed: (subject) => `La lettura della scena lo conferma: ${subject}.`,
    conflict: (reading, detector) => `La lettura della scena non concorda: indica ${reading}, il rilevatore indica ${detector}. Consideralo non risolto.`,
    suggested: (name, description) => `Suggerito: «${name}» – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Nessun rumore visibile a dimensione piena, quindi non è stato cambiato nulla.',
    protectionLost: 'Questa volta il soggetto non poteva essere protetto in sicurezza. Le tue modifiche sono state mantenute.',
    cloud: 'Rumore ridotto nel cloud InFlight da una copia di lavoro e verificato su questo dispositivo.',
    cloudNotUsed: 'Questa volta il cloud non è stato usato, quindi l’elaborazione è avvenuta su questo dispositivo.',
    device: 'Rumore ridotto su questo dispositivo.',
    layersFull: 'Non ogni soggetto poteva avere un proprio livello, quindi è stato usato un solo livello di protezione comune.',
    protected: (count) => (count === 1
      ? 'Rumore ridotto su questo dispositivo, con il soggetto protetto.'
      : `Rumore ridotto su questo dispositivo, con ${count} soggetti protetti insieme.`),
    global: 'Nessun contorno del soggetto era affidabile, quindi la riduzione del rumore è stata applicata in modo uniforme a tutta la foto.',
    failedCheck: 'Il risultato non ha superato il controllo di qualità. Le tue modifiche sono state mantenute.',
    leftAsItWas: (notes) => `Lasciata com’era. ${notes}`,
  },
};
