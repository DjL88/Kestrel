import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** French. DRAFT: written without a native speaker's check. Type names (Eurofighter Typhoon, Boeing 737) are proper names and stay as they are. */
export const fr: AreaTranslation<typeof source> = {
  heading: 'Véhicule',
  families: { air: 'Aéronef', road: 'Véhicule routier', rail: 'Véhicule ferroviaire', water: 'Bateau' },
  kinds: {
    car: 'Voiture',
    motorbike: 'Moto',
    lorry: 'Poids lourd',
    bus: 'Bus',
    train: 'Train',
    tram: 'Tramway',
    boat: 'Bateau ou navire',
    helicopter: 'Hélicoptère',
    airliner: 'Avion de ligne',
    'light-aircraft': 'Avion léger',
    'military-jet': 'Avion de chasse',
    'military-transport': 'Avion de transport militaire',
    glider: 'Planeur',
    drone: 'Drone',
    balloon: 'Ballon',
  },
  probably: (what: string) => `${what} (probablement)`,
  typeUnknown: (what: string) => `${what}, type inconnu`,
  withType: (kind: string, type: string) => `${kind} : ${type}`,
  marked: (what: string, marking: string) => `${what}, marqué ${marking}`,
  registered: (marking: string, type: string) => `${marking} : ${type} (d'après le registre)`,
  operatedBy: (what: string, operator: string) => `${what}, exploité par ${operator}`,
  held: (what: string) => `${what}? À vérifier`,
  reader: {
    title: 'Lire les immatriculations d’aéronefs',
    description: (megabytes: string) => `Lit les immatriculations et numéros de série militaires peints sur les aéronefs, sur cet appareil, et les recherche dans une copie hors ligne de registres publics. Un téléchargement unique de ${megabytes} Mo. Les plaques d’immatriculation des voitures ne sont jamais lues.`,
    download: 'Télécharger',
    downloading: (percent: number) => `Téléchargement… ${percent}%`,
    ready: 'Installé. Fonctionne hors ligne.',
    remove: 'Supprimer',
    failed: 'Le téléchargement n’a pas abouti, rien n’a été conservé. Réessayez.',
  },
};
