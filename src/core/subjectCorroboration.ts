/**
 * Two independent witnesses to what a photo is mainly of: the on-device scene reading and the object detector.
 *
 * Neither is trusted alone. A subject is shown only when both name the same kind of thing. When they disagree
 * (a bird against an aircraft above all) the photo is flagged for a person to check and nothing is asserted. One
 * witness on its own shows nothing new: it is a hypothesis, not a fact. This never changes a photo, a decision or a
 * tag; it only decides what the Photo Check may say.
 *
 * Measured basis (docs/models.md): on 100 European bird photos the scene reading never called a bird an aircraft, and
 * on 12 helicopters it never called one a bird. The sample is small and the photos are clean portraits, so this is a
 * cautious second opinion and not proof.
 */
export type Witness = 'bird' | 'aircraft' | 'person' | 'animal' | 'vehicle';

const word = (pattern: string) => new RegExp(`\\b(?:${pattern})\\b`, 'i');

// Whole words only. Ambiguous words (crane, kite) are left out on purpose: they are as often a machine or a toy.
const KINDS: ReadonlyArray<[Witness, RegExp]> = [
  ['bird', word('birds?|owls?|eagles?|hawks?|falcons?|kestrels?|robins?|ducks?|ducklings?|geese|goose|gulls?|seagulls?|swans?|herons?|egrets?|kingfishers?|sparrows?|puffins?|penguins?|terns?|swallows?|swifts?|martins?|finch(?:es)?|tits?|wrens?|crows?|ravens?|rooks?|jackdaws?|choughs?|magpies?|jays?|godwits?|plovers?|curlews?|sandpipers?|waders?|pigeons?|doves?|storks?|gannets?|cormorants?|pelicans?|parrots?|buzzards?|vultures?|pheasants?|partridges?|grebes?|mallards?|avocets?|lapwings?|oystercatchers?|razorbills?|guillemots?|fulmars?|skuas?|warblers?|thrushes|thrush|blackbirds?|starlings?|woodpeckers?|nuthatch(?:es)?|bullfinch(?:es)?|chaffinch(?:es)?|robin|waxwings?|hoopoes?|bee-eaters?|flamingos?|ibis(?:es)?|spoonbills?|peacocks?|peafowl|turkeys?|chickens?|hens?|roosters?')],
  ['aircraft', word('helicopters?|aircraft|airplanes?|aeroplanes?|planes?|jets?|choppers?|rotorcraft|airliners?|gliders?|drones?|biplanes?|fighter jets?')],
  ['person', word('woman|women|man|men|person|people|child|children|girl|boy|portrait|couple|bride|groom|astronaut|photographer|baby|toddler|crowd')],
  ['animal', word('cats?|kittens?|dogs?|puppy|puppies|foxe?s?|deer|horses?|cows?|sheep|rabbits?|squirrels?|animals?|bears?|wolf|wolves|lions?|tigers?|elephants?|zebras?|giraffes?|hedgehogs?|badgers?|otters?|seals?|goats?|pigs?')],
  ['vehicle', word('cars?|trucks?|buses|bus|vans?|boats?|ships?|trains?|motorcycles?|bicycles?|bikes?|tractors?|lorry|lorries|yacht|ferry')],
];

/** What the scene reading is about, or null when it names nothing, or names more than one kind (then it is not clear). */
export function modelWitness(description: unknown): Witness | null {
  const text = typeof description === 'string' ? description.slice(0, 600) : '';
  const found = KINDS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  return found.length === 1 ? found[0] : null;
}

const DETECTOR_KINDS: Readonly<Record<string, Witness>> = {
  bird: 'bird', airplane: 'aircraft', person: 'person',
  cat: 'animal', dog: 'animal', horse: 'animal', sheep: 'animal', cow: 'animal', elephant: 'animal', bear: 'animal', zebra: 'animal', giraffe: 'animal',
  car: 'vehicle', truck: 'vehicle', bus: 'vehicle', motorcycle: 'vehicle', bicycle: 'vehicle', boat: 'vehicle', train: 'vehicle',
};
/** The detector must be reasonably sure; a weak box is no witness. Matches the subject router's own threshold. */
export const DETECTOR_MIN_SCORE = 0.5;

export function detectorWitness(evidence: { label: string; score: number } | null | undefined): Witness | null {
  if (!evidence || !(evidence.score >= DETECTOR_MIN_SCORE)) return null;
  return DETECTOR_KINDS[evidence.label.toLowerCase()] ?? null;
}

export type Corroboration =
  /** Both name the same kind: it can be shown. */
  | { state: 'agreed'; subject: Witness }
  /** They name different kinds: show nothing about the subject, ask for a check. */
  | { state: 'conflict'; reading: Witness; detector: Witness }
  /** Only one witness named a kind, or neither did: nothing is asserted. */
  | { state: 'unverified' };

export function corroborateSubject(reading: Witness | null, detector: Witness | null): Corroboration {
  if (reading && detector) return reading === detector ? { state: 'agreed', subject: reading } : { state: 'conflict', reading, detector };
  return { state: 'unverified' };
}
