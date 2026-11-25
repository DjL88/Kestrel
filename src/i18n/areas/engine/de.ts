import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Weißabgleich', temperature: 'Temperatur', tint: 'Tönung', exposure: 'Belichtung', contrast: 'Kontrast',
    highlights: 'Lichter', shadows: 'Tiefen', whites: 'Weiß', blacks: 'Schwarz', toneCurve: 'Gradationskurve',
    vibrance: 'Dynamik', saturation: 'Sättigung', colourMixer: 'Farbmischer', clarity: 'Klarheit', detailRecovery: 'Textur',
    sharpen: 'Schärfen', denoiseLuminance: 'Luminanzrauschen', denoiseColour: 'Farbrauschen', upscaleFactor: 'Hochskalieren',
    masks: 'Lokale Anpassungen',
  },
  notMeasured: 'Nicht gemessen',
  notRecorded: 'Nicht erfasst',
  suggestedName: (name) => `${name} (Vorschlag)`,
  subjectKinds: { wildlife: 'Wildtiere', people: 'Menschen', landscape: 'Landschaft', other: 'Anderes Motiv' },
  auto: {
    ready: 'Geprüfte Bearbeitungsvorschläge sind bereit zur Vorschau.',
    noneDifferent: 'Keine sichtbar andere Bearbeitung hat die Prüfungen bestanden.',
    appliedGentler: 'Auto hat eine sanftere Version angewendet: Die volle Version hat eine Sicherheitsprüfung nicht bestanden.',
    applied: 'Auto angewendet. Stellen Sie die Stärke nach Geschmack ein oder machen Sie es rückgängig.',
    looksGood: 'Sieht gut aus: Die gemessenen Werte liegen im Bereich, daher wurde nichts geändert.',
    cannotImprove: 'Das lässt sich nicht sicher verbessern, daher wurde nichts geändert.',
    withheld: 'Ein Bearbeitungsvorschlag wurde zurückgehalten, weil er eine Prüfung nicht bestanden hat.',
    multipleSubjects: 'Jedes Motiv wurde einzeln auf verlorene Lichter und Tiefen geprüft. Die Farbkorrektur nach Art wurde zurückgehalten.',
    coverageUnavailable: 'Nicht jedes Motiv ließ sich umreißen, daher wurden nur Vorschläge für das ganze Foto berücksichtigt.',
    speciesReference: (features) => `Artreferenz (ein Anhaltspunkt, keine gemessene Farbe): ${features}`,
  },
  deepReview: {
    none: 'Tiefenprüfung: Kein Motiv gefunden, dem der Detektor vertraut.',
    confidence: { high: 'hoher', medium: 'mittlerer', low: 'niedriger' },
    sharpness: { subjectSharp: 'scharf', subjectOk: 'recht scharf', subjectSoft: 'unscharf', noSubject: 'unklar', unavailable: 'unklar' },
    trusted: (confidence, sharpness) => `Tiefenprüfung: Motiv mit ${confidence} Sicherheit gefunden, es ist ${sharpness}.`,
    untrusted: (sharpness) => `Tiefenprüfung: Ein Motiv wurde gefunden, ist aber zu ${sharpness}, um ihm zu vertrauen.`,
    witness: { bird: 'Vogel', aircraft: 'Flugzeug', person: 'Person', animal: 'Tier', vehicle: 'Fahrzeug' },
    agreed: (subject) => `Die Szenenerkennung bestätigt: ${subject}.`,
    conflict: (reading, detector) => `Die Szenenerkennung widerspricht: Sie sagt ${reading}, der Detektor sagt ${detector}. Behandeln Sie das als ungeklärt.`,
    suggested: (name, description) => `Vorschlag: „${name}“ – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'In voller Größe wurde kein sichtbares Rauschen gefunden, daher wurde nichts geändert.',
    protectionLost: 'Das Motiv ließ sich diesmal nicht sicher schützen. Ihre bisherigen Bearbeitungen wurden beibehalten.',
    cloud: 'In der InFlight-Cloud aus einer Arbeitskopie entrauscht und auf diesem Gerät geprüft.',
    cloudNotUsed: 'Die Cloud wurde hierfür nicht genutzt, daher lief es auf diesem Gerät.',
    device: 'Auf diesem Gerät entrauscht.',
    layersFull: 'Nicht jedes Motiv konnte eine eigene Ebene bekommen, daher wurde eine gemeinsame Schutzebene verwendet.',
    protected: (count) => (count === 1
      ? 'Auf diesem Gerät entrauscht, das Motiv ist geschützt.'
      : `Auf diesem Gerät entrauscht, ${count} Motive sind gemeinsam geschützt.`),
    global: 'Kein Motivumriss war zuverlässig, daher wurde das ganze Foto gleichmäßig entrauscht.',
    failedCheck: 'Das Ergebnis hat die Qualitätsprüfung nicht bestanden. Ihre bisherigen Bearbeitungen wurden beibehalten.',
    leftAsItWas: (notes) => `Unverändert gelassen. ${notes}`,
  },
};
