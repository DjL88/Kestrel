import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Welsh. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const cy: AreaTranslation<typeof source> = {
  heading: 'Cerbyd',
  families: { air: 'Awyren', road: 'Cerbyd ffordd', rail: 'Cerbyd rheilffordd', water: 'Cwch' },
  kinds: {
    car: 'Car',
    motorbike: 'Beic modur',
    lorry: 'Lori',
    bus: 'Bws',
    train: 'Trên',
    tram: 'Tram',
    boat: 'Cwch neu long',
    helicopter: 'Hofrennydd',
    airliner: 'Awyren deithwyr',
    'light-aircraft': 'Awyren ysgafn',
    'military-jet': 'Jet milwrol',
    'military-transport': 'Awyren cludo milwrol',
    glider: 'Gleider',
    drone: 'Drôn',
    balloon: 'Balŵn',
  },
  probably: (what: string) => `${what} (mae'n debyg)`,
  typeUnknown: (what: string) => `${what}, math anhysbys`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
