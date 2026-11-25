import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const ga: AreaTranslation<typeof source> = {
  heading: 'Feithicil',
  families: { air: 'Aerárthach', road: 'Feithicil bhóthair', rail: 'Feithicil iarnróid', water: 'Bád' },
  kinds: {
    car: 'Carr',
    motorbike: 'Gluaisrothar',
    lorry: 'Leoraí',
    bus: 'Bus',
    train: 'Traein',
    tram: 'Tram',
    boat: 'Bád nó long',
    helicopter: 'Héileacaptar',
    airliner: 'Aerlínéar',
    'light-aircraft': 'Aerárthach éadrom',
    'military-jet': 'Scairdeitleán míleata',
    'military-transport': 'Aerárthach iompair míleata',
    glider: 'Faoileoir',
    drone: 'Dróin',
    balloon: 'Balún',
  },
  probably: (what: string) => `${what} (is dócha)`,
  typeUnknown: (what: string) => `${what}, cineál anaithnid`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
