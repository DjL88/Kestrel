import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const de: AreaTranslation<typeof source> = {
  heading: 'Fahrzeug',
  families: { air: 'Luftfahrzeug', road: 'Straßenfahrzeug', rail: 'Schienenfahrzeug', water: 'Boot' },
  kinds: {
    car: 'Auto',
    motorbike: 'Motorrad',
    lorry: 'Lkw',
    bus: 'Bus',
    train: 'Zug',
    tram: 'Straßenbahn',
    boat: 'Boot oder Schiff',
    helicopter: 'Hubschrauber',
    airliner: 'Verkehrsflugzeug',
    'light-aircraft': 'Leichtflugzeug',
    'military-jet': 'Militärjet',
    'military-transport': 'Militärtransporter',
    glider: 'Segelflugzeug',
    drone: 'Drohne',
    balloon: 'Ballon',
  },
  probably: (what: string) => `${what} (wahrscheinlich)`,
  typeUnknown: (what: string) => `${what}, Typ unbekannt`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
