import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const is: AreaTranslation<typeof source> = {
  heading: 'Farartæki',
  families: { air: 'Loftfar', road: 'Ökutæki á vegi', rail: 'Járnbrautarökutæki', water: 'Bátur' },
  kinds: {
    car: 'Bíll',
    motorbike: 'Mótorhjól',
    'racing-car': 'Kappakstursbíll',
    'racing-motorbike': 'Kappakstursmótorhjól',
    lorry: 'Vörubíll',
    bus: 'Strætó',
    train: 'Lest',
    tram: 'Sporvagn',
    boat: 'Bátur eða skip',
    helicopter: 'Þyrla',
    airliner: 'Farþegaþota',
    'light-aircraft': 'Smáflugvél',
    'military-jet': 'Herþota',
    'military-transport': 'Herflutningavél',
    glider: 'Sviffluga',
    drone: 'Dróni',
    balloon: 'Loftbelgur',
  },
  probably: (what: string) => `${what} (líklega)`,
  typeUnknown: (what: string) => `${what}, gerð óþekkt`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
  marked: (what: string, marking: string) => `${what}, merkt ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (samkvæmt skrá)`,
  operatedBy: (what: string, operator: string) => `${what}, rekið af ${operator}`,
  held: (what: string) => `${what}? Þarf að yfirfara`,
  raceNumber: (what: string, number: string) => `${what}, númer ${number}`,
  reader: {
    title: 'Lesa skráningar og keppnisnúmer',
    description: (megabytes: string) => `Les á þessu tæki skráningar og hernaðarleg raðnúmer á loftförum, og keppnisnúmer á kappakstursbílum og kappakstursmótorhjólum. Skráningum er flett upp í ónettengdu afriti af opinberum skrám. Einstakt niðurhal upp á ${megabytes} MB. Bílnúmer eru aldrei lesin.`,
    download: 'Sækja',
    downloading: (percent: number) => `Sæki… ${percent}%`,
    ready: 'Uppsett. Virkar án nettengingar.',
    remove: 'Fjarlægja',
    failed: 'Niðurhalinu lauk ekki, svo ekkert var geymt. Reyndu aftur.',
  },
};
