import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. */
export const fi: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Valkotasapaino', temperature: 'Lämpötila', tint: 'Sävy', exposure: 'Valotus', contrast: 'Kontrasti',
    highlights: 'Valoalueet', shadows: 'Varjot', whites: 'Valkoiset', blacks: 'Mustat', toneCurve: 'Sävykäyrä',
    vibrance: 'Eloisuus', saturation: 'Kylläisyys', colourMixer: 'Värimikseri', clarity: 'Selkeys', detailRecovery: 'Tekstuuri',
    sharpen: 'Terävöinti', denoiseLuminance: 'Luminanssikohina', denoiseColour: 'Värikohina', upscaleFactor: 'Suurennus',
    masks: 'Paikalliset säädöt',
  },
  notMeasured: 'Ei mitattu',
  notRecorded: 'Ei tallennettu',
  suggestedName: (name) => `${name} (ehdotus)`,
  subjectKinds: { wildlife: 'Luonto', people: 'Ihmiset', landscape: 'Maisema', other: 'Muu kohde' },
  auto: {
    ready: 'Tarkistetut muokkausehdotukset ovat valmiina esikatseluun.',
    noneDifferent: 'Yksikään näkyvästi erilainen muokkaus ei läpäissyt tarkistuksia.',
    appliedGentler: 'Auto käytti lievempää versiota: täysi versio ei läpäissyt turvatarkistusta.',
    applied: 'Auto käytetty. Säädä voimakkuus mieleiseksi tai kumoa.',
    looksGood: 'Näyttää hyvältä: mitatut arvot ovat alueella, joten mitään ei muutettu.',
    cannotImprove: 'Tätä ei voi parantaa turvallisesti, joten mitään ei muutettu.',
    withheld: 'Muokkausehdotus jätettiin pois, koska se ei läpäissyt tarkistusta.',
    multipleSubjects: 'Jokainen kohde tarkistettiin erikseen menetettyjen valoalueiden ja varjojen varalta. Lajin mukainen värikorjaus jätettiin pois.',
    coverageUnavailable: 'Kaikkia kohteita ei voitu rajata, joten vain koko kuvan ehdotuksia harkittiin.',
    speciesReference: (features) => `Lajin viite (suuntaa antava, ei mitattu väri): ${features}`,
  },
  deepReview: {
    none: 'Syväkatselmus: kuvasta ei löytynyt kohdetta, johon tunnistin luottaa.',
    confidence: { high: 'suuri', medium: 'kohtalainen', low: 'pieni' },
    sharpness: { subjectSharp: 'terävä', subjectOk: 'melko terävä', subjectSoft: 'epätarkka', noSubject: 'epäselvä', unavailable: 'epäselvä' },
    trusted: (confidence, sharpness) => `Syväkatselmus: löytyi ${sharpness} kohde, varmuus ${confidence}.`,
    untrusted: (sharpness) => `Syväkatselmus: löytyi kohde, joka on liian ${sharpness} luotettavaksi.`,
    witness: { bird: 'lintu', aircraft: 'lentokone', person: 'ihminen', animal: 'eläin', vehicle: 'ajoneuvo' },
    agreed: (subject) => `Näkymän tulkinta vahvistaa: ${subject}.`,
    conflict: (reading, detector) => `Näkymän tulkinta on eri mieltä: se sanoo ${reading}, tunnistin sanoo ${detector}. Pidä tätä ratkaisemattomana.`,
    suggested: (name, description) => `Ehdotus: ”${name}” – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Täysikokoisena näkyvää kohinaa ei löytynyt, joten mitään ei muutettu.',
    protectionLost: 'Kohdetta ei voitu suojata turvallisesti tällä kertaa. Nykyiset muokkauksesi säilytettiin.',
    cloud: 'Kohina poistettiin InFlight-pilvessä työkopiosta ja tarkistettiin tällä laitteella.',
    cloudNotUsed: 'Pilveä ei käytetty tällä kertaa, joten käsittely tehtiin tällä laitteella.',
    device: 'Kohina poistettiin tällä laitteella.',
    layersFull: 'Kaikille kohteille ei saatu omaa tasoa, joten käytettiin yhtä yhteistä suojaustasoa.',
    protected: (count) => (count === 1
      ? 'Kohina poistettiin tällä laitteella, kohde suojattuna.'
      : `Kohina poistettiin tällä laitteella, ${count} kohdetta suojattuna yhdessä.`),
    global: 'Yksikään kohteen rajaus ei ollut luotettava, joten kohinanpoisto tehtiin tasaisesti koko kuvaan.',
    failedCheck: 'Tulos ei läpäissyt laatutarkistusta. Nykyiset muokkauksesi säilytettiin.',
    leftAsItWas: (notes) => `Jätettiin ennalleen. ${notes}`,
  },
};
