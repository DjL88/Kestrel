import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const ga: AreaTranslation<typeof source> = {
  heading: 'Feithicil',
  families: { air: 'Aerárthach', road: 'Feithicil bhóthair', rail: 'Feithicil iarnróid', water: 'Bád' },
  kinds: {
    car: 'Carr',
    motorbike: 'Gluaisrothar',
    'racing-car': 'Carr rásaíochta',
    'racing-motorbike': 'Gluaisrothar rásaíochta',
    lorry: 'Leoraí',
    bus: 'Bus',
    train: 'Traein',
    tram: 'Tram',
    boat: 'Bád nó long',
    helicopter: 'Héileacaptar',
    airliner: 'Aerlínéar',
    'light-aircraft': 'Aerárthach éadrom',
    'military-jet': 'Scairdeitleán míleata',
    'military-transport': 'Aerárthach iompair míleata',
    glider: 'Faoileoir',
    drone: 'Dróin',
    balloon: 'Balún',
  },
  probably: (what: string) => `${what} (is dócha)`,
  typeUnknown: (what: string) => `${what}, cineál anaithnid`,
  withType: (kind: string, type: string) => `${kind}: ${type}`,
  marked: (what: string, marking: string) => `${what}, marcáilte ${marking}`,
  registered: (marking: string, type: string) => `${marking}: ${type} (ón gclár)`,
  operatedBy: (what: string, operator: string) => `${what}, á oibriú ag ${operator}`,
  held: (what: string) => `${what}? Ní mór duit é a sheiceáil`,
  raceNumber: (what: string, number: string) => `${what}, uimhir ${number}`,
  reader: {
    title: 'Léigh clárúcháin agus uimhreacha rásaíochta',
    description: (megabytes: string) => `Léann sé clárúcháin agus sraithuimhreacha míleata ar aerárthaí, agus uimhreacha rásaíochta ar charranna agus ar ghluaisrothair rásaíochta, ar an ngléas seo. Cuardaítear clárúcháin i gcóip as líne de chláir phoiblí. Íoslódáil aonuaire de ${megabytes} MB. Ní léitear uimhirphlátaí feithiclí bóthair riamh.`,
    download: 'Íoslódáil',
    downloading: (percent: number) => `Á íoslódáil… ${percent}%`,
    ready: 'Suiteáilte. Oibríonn sé as líne.',
    remove: 'Bain',
    failed: 'Níor chríochnaigh an íoslódáil, mar sin níor coinníodh aon rud. Bain triail eile as.',
  },
};
