import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Spanish. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const es: AreaTranslation<typeof source> = {
  heading: 'Vehículo',
  families: { air: 'Aeronave', road: 'Vehículo de carretera', rail: 'Vehículo ferroviario', water: 'Barco' },
  kinds: {
    car: 'Coche',
    motorbike: 'Moto',
    lorry: 'Camión',
    bus: 'Autobús',
    train: 'Tren',
    tram: 'Tranvía',
    boat: 'Barco o buque',
    helicopter: 'Helicóptero',
    airliner: 'Avión comercial',
    'light-aircraft': 'Avioneta',
    'military-jet': 'Caza militar',
    'military-transport': 'Avión de transporte militar',
    glider: 'Planeador',
    drone: 'Dron',
    balloon: 'Globo',
  },
  probably: (what: string) => `${what} (probablemente)`,
  typeUnknown: (what: string) => `${what}, tipo desconocido`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
