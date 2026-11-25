import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const fr: AreaTranslation<typeof source> = {
  heading: 'Véhicule',
  families: { air: 'Aéronef', road: 'Véhicule routier', rail: 'Véhicule ferroviaire', water: 'Bateau' },
  kinds: {
    car: 'Voiture',
    motorbike: 'Moto',
    lorry: 'Poids lourd',
    bus: 'Bus',
    train: 'Train',
    tram: 'Tramway',
    boat: 'Bateau ou navire',
    helicopter: 'Hélicoptère',
    airliner: 'Avion de ligne',
    'light-aircraft': 'Avion léger',
    'military-jet': 'Avion de chasse',
    'military-transport': 'Avion de transport militaire',
    glider: 'Planeur',
    drone: 'Drone',
    balloon: 'Ballon',
  },
  probably: (what: string) => `${what} (probablement)`,
  typeUnknown: (what: string) => `${what}, type inconnu`,
  withType: (kind: string, type: string) => `${kind} : ${type}`,
};
