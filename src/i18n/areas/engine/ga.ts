import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. Noise uses torann, as elsewhere; see the wording audit's question. */
export const ga: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Cothromaíocht bháin', temperature: 'Teocht', tint: 'Imir', exposure: 'Nochtadh', contrast: 'Codarsnacht',
    highlights: 'Buaicphointí', shadows: 'Scáthanna', whites: 'Bánna', blacks: 'Dubha', toneCurve: 'Cuar toin',
    vibrance: 'Beogacht', saturation: 'Sáithiú', colourMixer: 'Meascthóir dathanna', clarity: 'Soiléireacht', detailRecovery: 'Uigeacht',
    sharpen: 'Géarú', denoiseLuminance: 'Torann lonrachais', denoiseColour: 'Torann datha', upscaleFactor: 'Méadú',
    masks: 'Coigeartuithe áitiúla',
  },
  notMeasured: 'Gan tomhas',
  notRecorded: 'Gan taifeadadh',
  suggestedName: (name) => `${name} (moladh)`,
  subjectKinds: { wildlife: 'Fiadhúlra', people: 'Daoine', landscape: 'Tírdhreach', other: 'Ábhar eile' },
  auto: {
    ready: 'Tá moltaí eagarthóireachta seiceáilte réidh le réamhamharc.',
    noneDifferent: 'Níor éirigh le haon eagarthóireacht a bhí difriúil go sofheicthe sna seiceálacha.',
    appliedGentler: 'Chuir Auto leagan níos séimhe i bhfeidhm: theip ar an leagan iomlán i seiceáil sábháilteachta.',
    applied: 'Cuireadh Auto i bhfeidhm. Tarraing an neart mar is mian leat, nó cealaigh é.',
    looksGood: 'Tá cuma mhaith air: tá na luachanna tomhaiste sa raon, mar sin níor athraíodh aon rud.',
    cannotImprove: 'Ní féidir é seo a fheabhsú go sábháilte, mar sin níor athraíodh aon rud.',
    withheld: 'Coinníodh siar eagarthóireacht mholta mar gur theip uirthi i seiceáil.',
    multipleSubjects: 'Seiceáladh gach ábhar ar leith le haghaidh buaicphointí agus scáthanna caillte. Coinníodh siar ceartú datha de réir speicis.',
    coverageUnavailable: 'Níorbh fhéidir imlíne a chur ar gach ábhar, mar sin níor breithníodh ach moltaí don ghrianghraf ar fad.',
    speciesReference: (features) => `Tagairt speicis (treoir, ní dath tomhaiste): ${features}`,
  },
  deepReview: {
    none: 'Athbhreithniú domhain: níor aimsíodh aon ábhar sa ghrianghraf seo a bhfuil muinín ag an mbrathadóir as.',
    confidence: { high: 'ard', medium: 'measartha', low: 'íseal' },
    sharpness: { subjectSharp: 'géar', subjectOk: 'measartha géar', subjectSoft: 'doiléir', noSubject: 'éiginnte', unavailable: 'éiginnte' },
    trusted: (confidence, sharpness) => `Athbhreithniú domhain: aimsíodh ábhar ${sharpness}, le muinín ${confidence}.`,
    untrusted: (sharpness) => `Athbhreithniú domhain: aimsíodh ábhar nach féidir muinín a bheith as (${sharpness}).`,
    witness: { bird: 'éan', aircraft: 'aerárthach', person: 'duine', animal: 'ainmhí', vehicle: 'feithicil' },
    agreed: (subject) => `Deimhníonn léamh an radhairc é: ${subject}.`,
    conflict: (reading, detector) => `Ní aontaíonn léamh an radhairc: deir sé ${reading}, deir an brathadóir ${detector}. Meas é seo mar rud gan réiteach.`,
    suggested: (name, description) => `Moladh: “${name}” – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Níor aimsíodh torann sofheicthe ag lánmhéid, mar sin níor athraíodh aon rud.',
    protectionLost: 'Níorbh fhéidir an t-ábhar a chosaint go sábháilte an uair seo. Coinníodh d’eagarthóireacht reatha.',
    cloud: 'Laghdaíodh torann i scamall InFlight ó chóip oibre, agus seiceáladh é ar an ngléas seo.',
    cloudNotUsed: 'Níor úsáideadh an scamall an uair seo, mar sin rith sé ar an ngléas seo.',
    device: 'Laghdaíodh torann ar an ngléas seo.',
    layersFull: 'Níorbh fhéidir a shraith féin a thabhairt do gach ábhar, mar sin úsáideadh sraith chosanta chomhpháirteach amháin.',
    protected: (count) => (count === 1
      ? 'Laghdaíodh torann ar an ngléas seo, agus an t-ábhar cosanta.'
      : `Laghdaíodh torann ar an ngléas seo, agus ${count} ábhar cosanta le chéile.`),
    global: 'Ní raibh imlíne aon ábhair iontaofa, mar sin laghdaíodh torann go cothrom ar fud an ghrianghraif.',
    failedCheck: 'Níor éirigh leis an toradh sa tseiceáil cháilíochta. Coinníodh d’eagarthóireacht reatha.',
    leftAsItWas: (notes) => `Fágadh mar a bhí. ${notes}`,
  },
};
