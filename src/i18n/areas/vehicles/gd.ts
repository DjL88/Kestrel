import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Scottish Gaelic. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const gd: AreaTranslation<typeof source> = {
  heading: 'Carbad',
  families: { air: 'Itealan', road: 'Carbad rathaid', rail: 'Carbad rèile', water: 'Bàta' },
  kinds: {
    car: 'Càr',
    motorbike: 'Motar-baidhsagal',
    lorry: 'Làraidh',
    bus: 'Bus',
    train: 'Trèana',
    tram: 'Trama',
    boat: 'Bàta no long',
    helicopter: 'Heileacoptair',
    airliner: 'Itealan-siubhail',
    'light-aircraft': 'Itealan beag',
    'military-jet': 'Jet armailteach',
    'military-transport': 'Itealan-giùlain armailteach',
    glider: 'Glaidhdear',
    drone: 'Drona',
    balloon: 'Bailiùn',
  },
  probably: (what: string) => `${what} (is dòcha)`,
  typeUnknown: (what: string) => `${what}, seòrsa neo-aithnichte`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
