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
  /** A registration or serial read from the aircraft that no offline register here covers. */
  marked: (what: string, marking: string) => `${what}, marked ${marking}`,
  /** An exact record from an offline public register (the FAA's for N-numbers). */
  registered: (marking: string, type: string) => `${marking}: ${type} (from the register)`,
  /** Only ever a company or government; no person's name is kept. */
  operatedBy: (what: string, operator: string) => `${what}, operated by ${operator}`,
  /** Settings → Assistance: the opt-in markings reader. */
  reader: {
    title: 'Read aircraft registrations',
    description: (megabytes: string) => `Reads registrations and military serials painted on aircraft, on this device, and looks them up in an offline copy of public registers. A one-off ${megabytes} MB download. Number plates on cars are never read.`,
    download: 'Download',
    downloading: (percent: number) => `Downloading… ${percent}%`,
    ready: 'Installed. Works offline.',
    remove: 'Remove',
    failed: 'The download did not finish, so nothing was kept. Try again.',
  },
};
