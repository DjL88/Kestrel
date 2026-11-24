import type { SpeciesGuess } from './speciesPalette';
export const speciesReferences = [
  { names: ['european robin','robin'], features: 'Adult orange-red face and breast; juvenile markings differ.', source: 'https://www.rspb.org.uk/whats-happening/big-garden-birdwatch/most-common-garden-birds-uk' },
  { names: ['red kite'], features: 'Adult reddish-brown body and pale head; retain natural tail shape.', source: 'https://www.rspb.org.uk/birds-and-wildlife/identifying-birds/whats-that-bird-of-prey' },
  { names: ['great tit'], features: 'Yellow underparts, dark central stripe and pale cheeks.', source: 'https://www.rspb.org.uk/whats-happening/big-garden-birdwatch/birds-to-spot' },
  { names: ['goldfinch','european goldfinch'], features: 'Adult red facial marking and yellow wing markings.', source: 'https://www.rspb.org.uk/whats-happening/big-garden-birdwatch/birds-to-spot' },
  { names: ['magpie','eurasian magpie'], features: 'Contrasting black and white plumage; iridescence depends on light.', source: 'https://www.rspb.org.uk/whats-happening/big-garden-birdwatch/most-common-garden-birds-uk' },
] as const;
/** Reference only, never a target colour or a numerical correction. */
export function speciesReference(guess: SpeciesGuess | null | undefined) {
  if (!guess || !Number.isFinite(guess.probability) || !Number.isFinite(guess.runnerUp) || guess.probability > 1 || guess.runnerUp < 0 || guess.runnerUp > 1 || guess.probability < 0.85 || guess.probability - guess.runnerUp < 0.6) return null;
  const name = guess.common.trim().toLowerCase();
  return speciesReferences.find(r => r.names.some(n => n === name)) ?? null;
}
