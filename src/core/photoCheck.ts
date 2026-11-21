/**
 * Scene facts from an on-device vision model's one-sentence description.
 *
 * The description is free text from a small model, so it is NEVER used as an instruction and never shown as advice.
 * It is searched for a few fixed keywords; anything not clearly mentioned stays unknown. The facts may only make the
 * measured advisor MORE cautious (a deliberate silhouette is not "underexposed"); they never raise confidence or
 * authorise an automatic change. Small models also hallucinate, notably on blank frames, which is why.
 */
export type SubjectKind = 'person' | 'animal' | 'bird' | 'landscape' | 'object';
export type LightKind = 'low-key' | 'high-key' | 'golden' | 'cool';
export interface SceneFacts { subject?: SubjectKind; light?: LightKind; sky?: boolean; foliage?: boolean }

const word = (pattern: string) => new RegExp(`\\b(?:${pattern})\\b`, 'i');
const SUBJECTS: ReadonlyArray<[SubjectKind, RegExp]> = [
  ['bird', word('birds?|owls?|kestrels?|eagles?|hawks?|falcons?|robins?|ducks?|geese|gulls?|swans?|herons?|kingfishers?|sparrows?')],
  ['person', word('woman|women|man|men|person|people|child|children|girl|boy|portrait|couple|bride|groom')],
  ['animal', word('cats?|kittens?|dogs?|puppy|foxe?s?|deer|horses?|cows?|sheep|rabbits?|squirrels?|animals?|bears?|wolf|wolves|lions?|tigers?')],
  ['landscape', word('landscape|mountains?|valleys?|fields?|coast|beach|lake|forest|hills?|sunset|sunrise|seascape|countryside')],
];
const LIGHTS: ReadonlyArray<[LightKind, RegExp]> = [
  ['low-key', word('silhouettes?|silhouetted|night|nighttime|moody|low[- ]light|dusk|dimly lit')],
  ['golden', word('sunset|sunrise|golden hour|golden light|golden|warm light|dawn')],
  ['high-key', word('snow|snowy|fog|foggy|mist|misty|high[- ]key')],
  ['cool', word('twilight|blue hour|moonlit|frosty|icy')],
];

export function factsFromDescription(description: string): SceneFacts {
  const text = typeof description === 'string' ? description.slice(0, 600) : '';
  const facts: SceneFacts = {};
  // Order matters: a bird in a landscape is a bird. The first specific subject wins.
  for (const [kind, pattern] of SUBJECTS) if (pattern.test(text)) { facts.subject = kind; break; }
  if (!facts.subject && /\b(?:cup|coffee|bottle|car|building|table|plate|food)\b/i.test(text)) facts.subject = 'object';
  for (const [kind, pattern] of LIGHTS) if (pattern.test(text)) { facts.light = kind; break; }
  if (word('sky|clouds?|cloudy|blue sky').test(text)) facts.sky = true;
  if (word('trees?|leaves|foliage|grass|meadow|forest|green plants?|bushes?').test(text)) facts.foliage = true;
  return facts;
}
