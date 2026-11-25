import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch (u). DRAFT: written without a native speaker's check. */
export const nl: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Witbalans', temperature: 'Temperatuur', tint: 'Tint', exposure: 'Belichting', contrast: 'Contrast',
    highlights: 'Hooglichten', shadows: 'Schaduwen', whites: 'Witte tinten', blacks: 'Zwarte tinten', toneCurve: 'Tooncurve',
    vibrance: 'Levendigheid', saturation: 'Verzadiging', colourMixer: 'Kleurmixer', clarity: 'Helderheid', detailRecovery: 'Textuur',
    sharpen: 'Verscherpen', denoiseLuminance: 'Luminantieruis', denoiseColour: 'Kleurruis', upscaleFactor: 'Opschalen',
    masks: 'Lokale aanpassingen',
  },
  notMeasured: 'Niet gemeten',
  notRecorded: 'Niet vastgelegd',
  suggestedName: (name) => `${name} (voorstel)`,
  subjectKinds: { wildlife: 'Wilde dieren', people: 'Mensen', landscape: 'Landschap', other: 'Ander onderwerp' },
  auto: {
    ready: 'Gecontroleerde bewerkingsvoorstellen staan klaar om te bekijken.',
    noneDifferent: 'Geen zichtbaar andere bewerking is door de controles gekomen.',
    appliedGentler: 'Auto heeft een mildere versie toegepast: de volledige versie zakte voor een veiligheidscontrole.',
    applied: 'Auto toegepast. Stel de sterkte naar smaak in, of maak het ongedaan.',
    looksGood: 'Ziet er goed uit: de gemeten waarden liggen binnen het bereik, dus er is niets veranderd.',
    cannotImprove: 'Dit is niet veilig te verbeteren, dus er is niets veranderd.',
    withheld: 'Een voorgestelde bewerking is tegengehouden omdat die niet door een controle kwam.',
    multipleSubjects: 'Elk onderwerp is apart gecontroleerd op verloren hooglichten en schaduwen. De kleurcorrectie per soort is tegengehouden.',
    coverageUnavailable: 'Niet elk onderwerp kon worden omlijnd, dus alleen voorstellen voor de hele foto zijn bekeken.',
    speciesReference: (features) => `Soortreferentie (een richtlijn, geen gemeten kleur): ${features}`,
  },
  deepReview: {
    none: 'Diepe controle: er is in deze foto geen onderwerp gevonden dat de detector vertrouwt.',
    confidence: { high: 'hoge', medium: 'gemiddelde', low: 'lage' },
    sharpness: { subjectSharp: 'scherp', subjectOk: 'redelijk scherp', subjectSoft: 'onscherp', noSubject: 'onduidelijk', unavailable: 'onduidelijk' },
    trusted: (confidence, sharpness) => `Diepe controle: onderwerp gevonden met ${confidence} zekerheid; het is ${sharpness}.`,
    untrusted: (sharpness) => `Diepe controle: onderwerp gevonden, maar te ${sharpness} om te vertrouwen.`,
    witness: { bird: 'vogel', aircraft: 'vliegtuig', person: 'persoon', animal: 'dier', vehicle: 'voertuig' },
    agreed: (subject) => `De scèneherkenning bevestigt: ${subject}.`,
    conflict: (reading, detector) => `De scèneherkenning is het oneens: die zegt ${reading}, de detector zegt ${detector}. Beschouw dit als onopgelost.`,
    suggested: (name, description) => `Voorstel: ‘${name}’ – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Op volle grootte is geen zichtbare ruis gevonden, dus er is niets veranderd.',
    protectionLost: 'Het onderwerp kon deze keer niet veilig worden beschermd. Uw bestaande bewerkingen zijn behouden.',
    cloud: 'Ruis verwijderd in de InFlight-cloud vanuit een werkkopie, en gecontroleerd op dit apparaat.',
    cloudNotUsed: 'De cloud is hiervoor niet gebruikt, dus het is op dit apparaat gedaan.',
    device: 'Ruis verwijderd op dit apparaat.',
    layersFull: 'Niet elk onderwerp kon een eigen laag krijgen, dus is één gezamenlijke beschermlaag gebruikt.',
    protected: (count) => (count === 1
      ? 'Ruis verwijderd op dit apparaat, met het onderwerp beschermd.'
      : `Ruis verwijderd op dit apparaat, met ${count} onderwerpen samen beschermd.`),
    global: 'Geen omtrek van een onderwerp was betrouwbaar, dus ruisonderdrukking is gelijkmatig op de hele foto toegepast.',
    failedCheck: 'Het resultaat kwam niet door de kwaliteitscontrole. Uw bestaande bewerkingen zijn behouden.',
    leftAsItWas: (notes) => `Gelaten zoals het was. ${notes}`,
  },
};
