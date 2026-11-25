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
  marked: (what: string, marking: string) => `${what}, Kennzeichen ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (laut Register)`,
  operatedBy: (what: string, operator: string) => `${what}, betrieben von ${operator}`,
  held: (what: string) => `${what}? Bitte prüfen`,
  reader: {
    title: 'Luftfahrzeugkennzeichen lesen',
    description: (megabytes: string) => `Liest auf Luftfahrzeuge gemalte Kennzeichen und militärische Seriennummern auf diesem Gerät und schlägt sie in einer Offline-Kopie öffentlicher Register nach. Ein einmaliger Download von ${megabytes} MB. Autokennzeichen werden nie gelesen.`,
    download: 'Herunterladen',
    downloading: (percent: number) => `Wird heruntergeladen… ${percent}%`,
    ready: 'Installiert. Funktioniert offline.',
    remove: 'Entfernen',
    failed: 'Der Download wurde nicht abgeschlossen, daher wurde nichts behalten. Bitte erneut versuchen.',
  },
};
