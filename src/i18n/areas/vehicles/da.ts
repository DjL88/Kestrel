import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Danish. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const da: AreaTranslation<typeof source> = {
  heading: 'Køretøj',
  families: { air: 'Luftfartøj', road: 'Vejkøretøj', rail: 'Skinnekøretøj', water: 'Båd' },
  kinds: {
    car: 'Bil',
    motorbike: 'Motorcykel',
    lorry: 'Lastbil',
    bus: 'Bus',
    train: 'Tog',
    tram: 'Sporvogn',
    boat: 'Båd eller skib',
    helicopter: 'Helikopter',
    airliner: 'Passagerfly',
    'light-aircraft': 'Let fly',
    'military-jet': 'Militærjet',
    'military-transport': 'Militært transportfly',
    glider: 'Svævefly',
    drone: 'Drone',
    balloon: 'Ballon',
  },
  probably: (what: string) => `${what} (sandsynligvis)`,
  typeUnknown: (what: string) => `${what}, ukendt type`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
