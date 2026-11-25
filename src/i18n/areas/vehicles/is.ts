import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Icelandic. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const is: AreaTranslation<typeof source> = {
  heading: 'Farartæki',
  families: { air: 'Loftfar', road: 'Ökutæki á vegi', rail: 'Járnbrautarökutæki', water: 'Bátur' },
  kinds: {
    car: 'Bíll',
    motorbike: 'Mótorhjól',
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
};
