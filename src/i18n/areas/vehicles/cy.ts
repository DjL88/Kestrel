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
  marked: (what: string, marking: string) => `${what}, wedi'i farcio ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (o'r gofrestr)`,
  operatedBy: (what: string, operator: string) => `${what}, a weithredir gan ${operator}`,
  reader: {
    title: 'Darllen cofrestriadau awyrennau',
    description: (megabytes: string) => `Yn darllen cofrestriadau a rhifau cyfresol milwrol sydd wedi’u peintio ar awyrennau, ar y ddyfais hon, ac yn eu chwilio mewn copi all-lein o gofrestrau cyhoeddus. Lawrlwythiad unwaith o ${megabytes} MB. Nid yw platiau rhif ceir byth yn cael eu darllen.`,
    download: 'Lawrlwytho',
    downloading: (percent: number) => `Yn lawrlwytho… ${percent}%`,
    ready: 'Wedi’i osod. Yn gweithio all-lein.',
    remove: 'Tynnu',
    failed: 'Ni orffennodd y lawrlwythiad, felly ni chadwyd dim. Rhowch gynnig arall arni.',
  },
};
