import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Finnish. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const fi: AreaTranslation<typeof source> = {
  heading: 'Ajoneuvo',
  families: { air: 'Ilma-alus', road: 'Tieajoneuvo', rail: 'Raideajoneuvo', water: 'Vene' },
  kinds: {
    car: 'Auto',
    motorbike: 'Moottoripyörä',
    lorry: 'Kuorma-auto',
    bus: 'Bussi',
    train: 'Juna',
    tram: 'Raitiovaunu',
    boat: 'Vene tai laiva',
    helicopter: 'Helikopteri',
    airliner: 'Matkustajakone',
    'light-aircraft': 'Pienlentokone',
    'military-jet': 'Sotilassuihkukone',
    'military-transport': 'Sotilaskuljetuskone',
    glider: 'Purjelentokone',
    drone: 'Drooni',
    balloon: 'Kuumailmapallo',
  },
  probably: (what: string) => `${what} (todennäköisesti)`,
  typeUnknown: (what: string) => `${what}, tyyppi tuntematon`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
