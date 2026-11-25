/**
 * Words for vehicle and aircraft recognition, in British English. Only kinds and the wording around a guess are
 * translated; make and type names (Eurofighter Typhoon, Boeing 737, Ford Fiesta) are proper names and are the same in
 * every language. Kind ids match `src/assets/vehicle/labels.json`.
 */
export const source = {
  heading: 'Vehicle',
  families: { air: 'Aircraft', road: 'Road vehicle', rail: 'Rail vehicle', water: 'Boat' },
  kinds: {
    car: 'Car',
    motorbike: 'Motorbike',
    lorry: 'Lorry',
    bus: 'Bus',
    train: 'Train',
    tram: 'Tram',
    boat: 'Boat or ship',
    helicopter: 'Helicopter',
    airliner: 'Airliner',
    'light-aircraft': 'Light aircraft',
    'military-jet': 'Military jet',
    'military-transport': 'Military transport',
    glider: 'Glider',
    drone: 'Drone',
    balloon: 'Balloon',
  },
  /** A look-alike guess, never stated as fact. */
  probably: (what: string) => `${what} (probably)`,
  /** The kind or family is clear but the make or type is not. */
  typeUnknown: (what: string) => `${what}, type unknown`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
};
