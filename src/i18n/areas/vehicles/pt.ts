import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Portuguese. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const pt: AreaTranslation<typeof source> = {
  heading: 'Veículo',
  families: { air: 'Aeronave', road: 'Veículo rodoviário', rail: 'Veículo ferroviário', water: 'Barco' },
  kinds: {
    car: 'Carro',
    motorbike: 'Mota',
    lorry: 'Camião',
    bus: 'Autocarro',
    train: 'Comboio',
    tram: 'Elétrico',
    boat: 'Barco ou navio',
    helicopter: 'Helicóptero',
    airliner: 'Avião comercial',
    'light-aircraft': 'Avião ligeiro',
    'military-jet': 'Jato militar',
    'military-transport': 'Avião de transporte militar',
    glider: 'Planador',
    drone: 'Drone',
    balloon: 'Balão',
  },
  probably: (what: string) => `${what} (provavelmente)`,
  typeUnknown: (what: string) => `${what}, tipo desconhecido`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
