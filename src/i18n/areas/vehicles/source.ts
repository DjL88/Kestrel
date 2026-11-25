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
    'racing-car': 'Racing car',
    'racing-motorbike': 'Racing motorbike',
    lorry: 'Lorry',
    bus: 'Bus',
    train: 'Train',
    tram: 'Tram',
    boat: 'Boat or ship',
    lifeboat: 'Lifeboat',
    ferry: 'Ferry',
    yacht: 'Yacht',
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
  /** The Vision guardian doubted even that it is an aircraft (or a road vehicle…): nothing is named. */
  held: (what: string) => `${what}? Needs your review`,
  /** A race number read from a racing car or bike, at a public sporting event. */
  raceNumber: (what: string, number: string) => `${what}, number ${number}`,
  named: (what: string, name: string) => `${what}, named ${name}`,
  /** Photo Info: the person's own correction, for one photo or the whole burst. */
  correct: {
    edit: 'Edit',
    change: 'Change the vehicle',
    kindLabel: 'Kind',
    typeLabel: 'Make or type',
    typeUnknown: 'Not sure',
    notVehicle: 'Not a vehicle',
    wholeBurst: (count: number) => `All ${count} photos in this burst`,
    save: 'Save',
    cancel: 'Cancel',
    saved: (count: number) => (count > 1 ? `Saved for ${count} photos.` : 'Saved.'),
  },
  /** Settings → Assistance: the opt-in markings reader. */
  reader: {
    title: 'Read registrations, race numbers and boat names',
    description: (megabytes: string) => `Reads registrations and military serials on aircraft, race numbers on racing cars and bikes, and names and IMO numbers on boats, on this device. Aircraft registrations are looked up in an offline copy of public registers. A one-off ${megabytes} MB download. Number plates on road vehicles are never read.`,
    download: 'Download',
    downloading: (percent: number) => `Downloading… ${percent}%`,
    ready: 'Installed. Works offline.',
    remove: 'Remove',
    failed: 'The download did not finish, so nothing was kept. Try again.',
  },
};
