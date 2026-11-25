import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Norwegian Bokmål. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const nb: AreaTranslation<typeof source> = {
  heading: 'Kjøretøy',
  families: { air: 'Luftfartøy', road: 'Veikjøretøy', rail: 'Skinnegående kjøretøy', water: 'Båt' },
  kinds: {
    car: 'Bil',
    motorbike: 'Motorsykkel',
    lorry: 'Lastebil',
    bus: 'Buss',
    train: 'Tog',
    tram: 'Trikk',
    boat: 'Båt eller skip',
    helicopter: 'Helikopter',
    airliner: 'Passasjerfly',
    'light-aircraft': 'Småfly',
    'military-jet': 'Militært jetfly',
    'military-transport': 'Militært transportfly',
    glider: 'Seilfly',
    drone: 'Drone',
    balloon: 'Ballong',
  },
  probably: (what: string) => `${what} (sannsynligvis)`,
  typeUnknown: (what: string) => `${what}, ukjent type`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
