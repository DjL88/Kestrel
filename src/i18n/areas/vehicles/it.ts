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
  marked: (what: string, marking: string) => `${what}, contrassegnato ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (dal registro)`,
  operatedBy: (what: string, operator: string) => `${what}, operato da ${operator}`,
  held: (what: string) => `${what}? Da verificare`,
  reader: {
    title: 'Leggi le marche degli aeromobili',
    description: (megabytes: string) => `Legge le marche e i numeri di serie militari dipinti sugli aeromobili, su questo dispositivo, e li cerca in una copia offline di registri pubblici. Un download unico di ${megabytes} MB. Le targhe delle auto non vengono mai lette.`,
    download: 'Scarica',
    downloading: (percent: number) => `Download in corso… ${percent}%`,
    ready: 'Installato. Funziona offline.',
    remove: 'Rimuovi',
    failed: 'Il download non è terminato, quindi non è stato conservato nulla. Riprova.',
  },
};
