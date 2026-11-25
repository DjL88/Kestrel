import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Swedish. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const sv: AreaTranslation<typeof source> = {
  heading: 'Fordon',
  families: { air: 'Luftfartyg', road: 'Vägfordon', rail: 'Spårfordon', water: 'Båt' },
  kinds: {
    car: 'Bil',
    motorbike: 'Motorcykel',
    lorry: 'Lastbil',
    bus: 'Buss',
    train: 'Tåg',
    tram: 'Spårvagn',
    boat: 'Båt eller fartyg',
    helicopter: 'Helikopter',
    airliner: 'Passagerarflygplan',
    'light-aircraft': 'Lätt flygplan',
    'military-jet': 'Militärt jetplan',
    'military-transport': 'Militärt transportflygplan',
    glider: 'Segelflygplan',
    drone: 'Drönare',
    balloon: 'Ballong',
  },
  probably: (what: string) => `${what} (troligen)`,
  typeUnknown: (what: string) => `${what}, okänd typ`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
  marked: (what: string, marking: string) => `${what}, märkt ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (enligt registret)`,
  operatedBy: (what: string, operator: string) => `${what}, drivs av ${operator}`,
  reader: {
    title: 'Läs registreringar på flygplan',
    description: (megabytes: string) => `Läser registreringar och militära serienummer som målats på luftfartyg, på den här enheten, och slår upp dem i en offlinekopia av offentliga register. En engångsnedladdning på ${megabytes} MB. Registreringsskyltar på bilar läses aldrig.`,
    download: 'Ladda ned',
    downloading: (percent: number) => `Laddar ned… ${percent}%`,
    ready: 'Installerat. Fungerar offline.',
    remove: 'Ta bort',
    failed: 'Nedladdningen blev inte klar, så inget sparades. Försök igen.',
  },
};
