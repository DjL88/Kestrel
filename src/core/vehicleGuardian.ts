import type { VehicleLabels, VehicleReading } from './vehicleRecognition';

/**
 * Vehicle and aircraft recognition, step 3: the Vision guardian (owner decision 2) gives a second opinion on each vehicle
 * name before it is shown. Same rules as the editor's guardian (#1447): only a plain "yes" or "no" counts, agreement adds
 * nothing (a "probably" stays "probably"), doubt changes nothing, and a clear "no" takes the name back one step:
 * - a type or registered type it rejects is withdrawn, leaving the kind ("Military jet, type unknown");
 * - a kind it rejects is withdrawn, leaving the family ("Aircraft, type unknown");
 * - a family it rejects ("Is there an aircraft?" "No") leaves nothing named, held for the person's review.
 * It never adds or upgrades a name. A name the person chose is never questioned. Pure: no model runs here.
 */
export type GuardianVerdict = 'agrees' | 'disagrees' | 'unsure';

/** Only a plain yes or a plain no counts. A hedge ("yes, but..."), a refusal or no answer is unsure. */
export function readYesNo(text: string | undefined): GuardianVerdict {
  const answer = (text ?? '').trim().toLowerCase();
  const first = /^([a-z]+)\b/.exec(answer)?.[1];
  if (first === 'no') return 'disagrees';
  if (first === 'yes') return /\b(but|however|although|though|except|maybe|possibly|might)\b/.test(answer) ? 'unsure' : 'agrees';
  return 'unsure';
}

/** Plain ASCII, as the on-device model needs ("Skoda" for "Škoda"). */
const ascii = (text: string) => text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();

export interface GuardianQuestion { level: 'type' | 'kind' | 'family'; text: string }

/**
 * The one question to ask about a reading: about its most specific claim, so a "no" withdraws exactly that claim.
 * `englishKinds` and `englishFamilies` are the British English words (src/i18n/areas/vehicles/source.ts).
 */
export function guardianQuestion(
  reading: VehicleReading, labels: VehicleLabels, englishKinds: Record<string, string>, englishFamilies: Record<string, string>,
): GuardianQuestion | null {
  if (reading.source === 'person' || reading.guardian) return null;
  const typeName = reading.registered?.type ?? (reading.type ? labels.types.find((entry) => entry.id === reading.type)?.name : undefined);
  if (typeName) return { level: 'type', text: `Is the vehicle in this photograph a ${ascii(typeName)}? Answer yes or no.` };
  if (reading.kind && englishKinds[reading.kind]) return { level: 'kind', text: `Is there a ${ascii(englishKinds[reading.kind]).toLowerCase()} in this photograph? Answer yes or no.` };
  const family = englishFamilies[reading.family];
  return family ? { level: 'family', text: `Is there ${reading.family === 'air' ? 'an' : 'a'} ${ascii(family).toLowerCase()} in this photograph? Answer yes or no.` } : null;
}

/** The reading after the guardian's answer. Never adds a claim; a "no" withdraws the claim the question was about. */
export function guardVehicle(reading: VehicleReading, question: GuardianQuestion, verdict: GuardianVerdict): VehicleReading {
  if (reading.source === 'person' || verdict === 'unsure') return reading;
  if (verdict === 'agrees') return { ...reading, guardian: 'agreed' };
  const { type: _type, typeProbability: _p, registered: _registered, ...withoutType } = reading;
  if (question.level === 'type') return { ...withoutType, guardian: 'held' };
  const { kind: _kind, kindProbability: _k, ...withoutKind } = withoutType;
  if (question.level === 'kind') return { ...withoutKind, guardian: 'held' };
  return { ...withoutKind, guardian: 'held', heldFamily: true };
}
