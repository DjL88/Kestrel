import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh (chi). DRAFT: written without a native speaker's check. Noise uses sŵn, as elsewhere; see the wording audit's question. */
export const cy: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Cydbwysedd gwyn', temperature: 'Tymheredd', tint: 'Arlliw', exposure: 'Datguddiad', contrast: 'Cyferbyniad',
    highlights: 'Uchafbwyntiau golau', shadows: 'Cysgodion', whites: 'Gwynion', blacks: 'Duon', toneCurve: 'Cromlin tôn',
    vibrance: 'Bywiogrwydd', saturation: 'Dirlawnder', colourMixer: 'Cymysgydd lliw', clarity: 'Eglurder', detailRecovery: 'Gwead',
    sharpen: 'Miniogi', denoiseLuminance: 'Sŵn goleuedd', denoiseColour: 'Sŵn lliw', upscaleFactor: 'Ehangu',
    masks: 'Addasiadau lleol',
  },
  notMeasured: 'Heb ei fesur',
  notRecorded: 'Heb ei gofnodi',
  suggestedName: (name) => `${name} (awgrym)`,
  subjectKinds: { wildlife: 'Bywyd gwyllt', people: 'Pobl', landscape: 'Tirwedd', other: 'Gwrthrych arall' },
  auto: {
    ready: 'Mae awgrymiadau golygu wedi’u gwirio yn barod i’w rhagweld.',
    noneDifferent: 'Ni wnaeth unrhyw olygiad gweladwy wahanol basio’r gwiriadau.',
    appliedGentler: 'Rhoddodd Auto fersiwn ysgafnach ar waith: methodd y fersiwn llawn wiriad diogelwch.',
    applied: 'Auto wedi’i roi ar waith. Llusgwch y cryfder at eich dant, neu dadwneud.',
    looksGood: 'Mae’n edrych yn dda: mae’r gwerthoedd a fesurwyd o fewn yr ystod, felly ni newidiwyd dim.',
    cannotImprove: 'Does dim modd gwella hyn yn ddiogel, felly ni newidiwyd dim.',
    withheld: 'Cafodd golygiad a awgrymwyd ei ddal yn ôl am iddo fethu gwiriad.',
    multipleSubjects: 'Cafodd pob gwrthrych ei wirio ar wahân am olau a chysgodion a gollwyd. Cafodd cywiro lliw yn ôl rhywogaeth ei ddal yn ôl.',
    coverageUnavailable: 'Doedd dim modd amlinellu pob gwrthrych, felly dim ond awgrymiadau ar gyfer y llun cyfan a ystyriwyd.',
    speciesReference: (features) => `Cyfeirnod rhywogaeth (canllaw, nid lliw a fesurwyd): ${features}`,
  },
  deepReview: {
    none: 'Adolygiad manwl: ni chafwyd hyd i wrthrych y mae’r synhwyrydd yn ymddiried ynddo yn y llun hwn.',
    confidence: { high: 'uchel', medium: 'canolig', low: 'isel' },
    sharpness: { subjectSharp: 'miniog', subjectOk: 'eithaf miniog', subjectSoft: 'aneglur', noSubject: 'ansicr', unavailable: 'ansicr' },
    trusted: (confidence, sharpness) => `Adolygiad manwl: cafwyd hyd i wrthrych ${sharpness}, gyda hyder ${confidence}.`,
    untrusted: (sharpness) => `Adolygiad manwl: cafwyd hyd i wrthrych na ellir ymddiried ynddo (${sharpness}).`,
    witness: { bird: 'aderyn', aircraft: 'awyren', person: 'person', animal: 'anifail', vehicle: 'cerbyd' },
    agreed: (subject) => `Mae darlleniad yr olygfa yn cadarnhau: ${subject}.`,
    conflict: (reading, detector) => `Mae darlleniad yr olygfa yn anghytuno: mae’n dweud ${reading}, ac mae’r synhwyrydd yn dweud ${detector}. Ystyriwch hyn heb ei ddatrys.`,
    suggested: (name, description) => `Awgrym: “${name}” – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Ni chafwyd sŵn gweladwy ar faint llawn, felly ni newidiwyd dim.',
    protectionLost: 'Doedd dim modd diogelu’r gwrthrych yn ddiogel y tro hwn. Cadwyd eich golygiadau presennol.',
    cloud: 'Lleihawyd sŵn yng nghwmwl InFlight o gopi gweithio, a’i wirio ar y ddyfais hon.',
    cloudNotUsed: 'Ni ddefnyddiwyd y cwmwl y tro hwn, felly rhedodd ar y ddyfais hon.',
    device: 'Lleihawyd sŵn ar y ddyfais hon.',
    layersFull: 'Doedd dim modd rhoi haen ei hun i bob gwrthrych, felly defnyddiwyd un haen ddiogelu gyfun.',
    protected: (count) => (count === 1
      ? 'Lleihawyd sŵn ar y ddyfais hon, gyda’r gwrthrych wedi’i ddiogelu.'
      : `Lleihawyd sŵn ar y ddyfais hon, gyda ${count} gwrthrych wedi’u diogelu gyda’i gilydd.`),
    global: 'Doedd dim amlinell gwrthrych yn ddibynadwy, felly lleihawyd sŵn yn gyfartal dros y llun cyfan.',
    failedCheck: 'Ni wnaeth y canlyniad basio’r gwiriad ansawdd. Cadwyd eich golygiadau presennol.',
    leftAsItWas: (notes) => `Gadawyd fel yr oedd. ${notes}`,
  },
};
