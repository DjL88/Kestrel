import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Dutch. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const nl: AreaTranslation<typeof source> = {
  heading: 'Voertuig',
  families: { air: 'Luchtvaartuig', road: 'Wegvoertuig', rail: 'Spoorvoertuig', water: 'Boot' },
  kinds: {
    car: 'Auto',
    motorbike: 'Motor',
    lorry: 'Vrachtwagen',
    bus: 'Bus',
    train: 'Trein',
    tram: 'Tram',
    boat: 'Boot of schip',
    helicopter: 'Helikopter',
    airliner: 'Verkeersvliegtuig',
    'light-aircraft': 'Licht vliegtuig',
    'military-jet': 'Militaire straaljager',
    'military-transport': 'Militair transportvliegtuig',
    glider: 'Zweefvliegtuig',
    drone: 'Drone',
    balloon: 'Ballon',
  },
  probably: (what: string) => `${what} (waarschijnlijk)`,
  typeUnknown: (what: string) => `${what}, type onbekend`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
