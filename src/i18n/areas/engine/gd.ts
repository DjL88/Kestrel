import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. Noise in a photo is gràinne (grain), as in the editor. */
export const gd: AreaTranslation<typeof source> = {
  steps: {
    whiteBalance: 'Cothromachadh geal', temperature: 'Teothachd', tint: 'Fiamh', exposure: 'Nochdadh', contrast: 'Iomsgaradh',
    highlights: 'Bàrr-solais', shadows: 'Faileasan', whites: 'Na geala', blacks: 'Na duibhe', toneCurve: 'Lùb tòna',
    vibrance: 'Beothalachd', saturation: 'Sàthachd', colourMixer: 'Measgaiche dhathan', clarity: 'Soilleireachd mhion', detailRecovery: 'Inneach',
    sharpen: 'Geurachadh', denoiseLuminance: 'Gràinne soillseachd', denoiseColour: 'Gràinne dhathan', upscaleFactor: 'Meudachadh',
    masks: 'Atharrachaidhean ionadail',
  },
  notMeasured: 'Gun tomhas',
  notRecorded: 'Gun chlàradh',
  suggestedName: (name) => `${name} (moladh)`,
  subjectKinds: { wildlife: 'Fiadh-bheatha', people: 'Daoine', landscape: 'Cruth-tìre', other: 'Cuspair eile' },
  auto: {
    ready: 'Tha molaidhean deasachaidh dearbhte deiseil airson ro-shealladh.',
    noneDifferent: 'Cha deach deasachadh sam bith a bha eadar-dhealaichte gu follaiseach tro na dearbhaidhean.',
    appliedGentler: 'Chuir Auto tionndadh nas ciùine an sàs: dh’fhàillig an tionndadh slàn dearbhadh sàbhailteachd.',
    applied: 'Chaidh Auto a chur an sàs. Slaod an neart mar a thogras tu, no neo-dhèan e.',
    looksGood: 'Tha e a’ coimhead math: tha na luachan a chaidh a thomhas taobh a-staigh na raoin, mar sin cha deach dad atharrachadh.',
    cannotImprove: 'Cha ghabh seo leasachadh gu sàbhailte, mar sin cha deach dad atharrachadh.',
    withheld: 'Chaidh deasachadh a chaidh a mholadh a chumail air ais oir dh’fhàillig e dearbhadh.',
    multipleSubjects: 'Chaidh gach cuspair a dhearbhadh leis fhèin airson bàrr-solais is faileasan a chaidh a chall. Chaidh ceartachadh dhathan a-rèir gnè a chumail air ais.',
    coverageUnavailable: 'Cha b’ urrainnear iomall a chur air gach cuspair, mar sin cha deach beachdachadh ach air molaidhean airson an deilbh air fad.',
    speciesReference: (features) => `Iomradh air a’ ghnè (stiùireadh, chan e dath a chaidh a thomhas): ${features}`,
  },
  deepReview: {
    none: 'Lèirmheas domhainn: cha deach cuspair a lorg san dealbh seo anns a bheil earbsa aig an lorgaire.',
    confidence: { high: 'àrd', medium: 'meadhanach', low: 'ìosal' },
    sharpness: { subjectSharp: 'geur', subjectOk: 'meadhanach geur', subjectSoft: 'doilleir', noSubject: 'mì-chinnteach', unavailable: 'mì-chinnteach' },
    trusted: (confidence, sharpness) => `Lèirmheas domhainn: chaidh cuspair ${sharpness} a lorg, le misneachd ${confidence}.`,
    untrusted: (sharpness) => `Lèirmheas domhainn: chaidh cuspair a lorg nach gabh earbsa ann (${sharpness}).`,
    witness: { bird: 'eun', aircraft: 'itealan', person: 'neach', animal: 'beathach', vehicle: 'carbad' },
    agreed: (subject) => `Tha leughadh an t-seallaidh ga dhearbhadh: ${subject}.`,
    conflict: (reading, detector) => `Chan eil leughadh an t-seallaidh ag aontachadh: tha e ag ràdh ${reading}, tha an lorgaire ag ràdh ${detector}. Meas seo mar rud gun fhuasgladh.`,
    suggested: (name, description) => `Moladh: “${name}” – ${description}`,
  },
  denoise: {
    noVisibleNoise: 'Cha deach gràinne fhaicsinneach a lorg aig làn mheud, mar sin cha deach dad atharrachadh.',
    protectionLost: 'Cha b’ urrainnear an cuspair a dhìon gu sàbhailte an turas seo. Chaidh na deasachaidhean agad a chumail.',
    cloud: 'Chaidh a’ ghràinne a lùghdachadh ann an neul InFlight o lethbhreac-obrach, agus a dhearbhadh air an uidheam seo.',
    cloudNotUsed: 'Cha deach an neul a chleachdadh an turas seo, mar sin ruith e air an uidheam seo.',
    device: 'Chaidh a’ ghràinne a lùghdachadh air an uidheam seo.',
    layersFull: 'Cha b’ urrainnear breath fa leth a thoirt do gach cuspair, mar sin chaidh aon bhreath dìon choitcheann a chleachdadh.',
    protected: (count) => (count === 1
      ? 'Chaidh a’ ghràinne a lùghdachadh air an uidheam seo, leis a’ chuspair dìonta.'
      : `Chaidh a’ ghràinne a lùghdachadh air an uidheam seo, le ${count} cuspairean dìonta còmhla.`),
    global: 'Cha robh iomall cuspair sam bith earbsach, mar sin chaidh lùghdachadh gràinne a chur air an dealbh air fad gu cothromach.',
    failedCheck: 'Cha deach an toradh tron dearbhadh càileachd. Chaidh na deasachaidhean agad a chumail.',
    leftAsItWas: (notes) => `Chaidh fhàgail mar a bha e. ${notes}`,
  },
};
