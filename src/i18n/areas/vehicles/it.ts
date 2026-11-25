import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Italian. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const it: AreaTranslation<typeof source> = {
  heading: 'Veicolo',
  families: { air: 'Aeromobile', road: 'Veicolo stradale', rail: 'Veicolo ferroviario', water: 'Imbarcazione' },
  kinds: {
    car: 'Auto',
    motorbike: 'Moto',
    lorry: 'Camion',
    bus: 'Autobus',
    train: 'Treno',
    tram: 'Tram',
    boat: 'Barca o nave',
    helicopter: 'Elicottero',
    airliner: 'Aereo di linea',
    'light-aircraft': 'Aereo leggero',
    'military-jet': 'Jet militare',
    'military-transport': 'Aereo da trasporto militare',
    glider: 'Aliante',
    drone: 'Drone',
    balloon: 'Mongolfiera',
  },
  probably: (what: string) => `${what} (probabilmente)`,
  typeUnknown: (what: string) => `${what}, tipo sconosciuto`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
