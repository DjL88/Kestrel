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
  marked: (what: string, marking: string) => `${what}, com a marca ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (segundo o registo)`,
  operatedBy: (what: string, operator: string) => `${what}, operado por ${operator}`,
  reader: {
    title: 'Ler matrículas de aeronaves',
    description: (megabytes: string) => `Lê matrículas e números de série militares pintados em aeronaves, neste dispositivo, e procura-os numa cópia offline de registos públicos. Uma transferência única de ${megabytes} MB. As matrículas dos carros nunca são lidas.`,
    download: 'Transferir',
    downloading: (percent: number) => `A transferir… ${percent}%`,
    ready: 'Instalado. Funciona offline.',
    remove: 'Remover',
    failed: 'A transferência não terminou, por isso nada foi guardado. Tente novamente.',
  },
};
