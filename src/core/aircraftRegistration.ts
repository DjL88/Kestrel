/**
 * Vehicle and aircraft recognition, steps 2 and 5: what painted text may be a registration or military serial on an
 * AIRCRAFT, or a race number on a RACING car or motorbike (painted for a public sporting event).
 *
 * Text is only ever read from a photo whose vehicle reading is an aircraft or clearly a racing vehicle (`markingContext`),
 * so an ordinary car's, van's or bike's number plate is never read. As a second guard, anything shaped like a UK or Irish number plate is dropped even on an aircraft, and only
 * the formats below are kept. Pure and deterministic: OCR output comes in as text, nothing is looked up here.
 */
import type { VehicleReading } from './vehicleRecognition';

export type MarkingFormat = 'uk-civil' | 'irish-civil' | 'us-civil' | 'uk-military' | 'race-number' | 'imo' | 'hull-name';

/** Racing kinds, where a race number (painted for a public sporting event) may be read. Never a road car or bike. */
export const RACING_KINDS: readonly string[] = ['racing-car', 'racing-motorbike'];

export interface Marking {
  /** Normalised: upper case, with the country's dash ("G-EZAA", "EI-DCL", "N172SP", "ZK301"). */
  value: string;
  format: MarkingFormat;
}

/**
 * Which text may be read from a photo: registrations and serials on an aircraft, race numbers on a photo clearly read as
 * a racing car or racing motorbike. Nothing else, so an ordinary car's, van's or bike's number plate is never read.
 */
export type MarkingContext = 'aircraft' | 'racing' | 'vessel';
export function markingContext(reading: VehicleReading | null | undefined): MarkingContext | null {
  if (reading?.family === 'air') return 'aircraft';
  // Boats carry no number plates; their names and IMO numbers are painted to be read.
  if (reading?.family === 'water') return 'vessel';
  if (reading?.family === 'road' && reading.kind && RACING_KINDS.includes(reading.kind)) return 'racing';
  return null;
}
export function mayReadMarkings(reading: VehicleReading | null | undefined): boolean {
  return markingContext(reading) !== null;
}

/**
 * A race number: a line that is only one to three digits ("7", "46", "993"). Anything else on a racing photo (sponsors,
 * plates, phone numbers, years) gives nothing. The plate guard still runs first.
 */
export function findRaceNumber(text: string): Marking[] {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (looksLikeNumberPlate(compact) || !/^\d{1,3}$/.test(compact)) return [];
  return [{ value: String(Number(compact)), format: 'race-number' }];
}

/**
 * The IMO ship number check: the first six digits times 7, 6, 5, 4, 3 and 2, summed; the last digit of that sum is the
 * seventh digit (IMO 9074729: 9×7 + 0×6 + 7×5 + 4×4 + 7×3 + 2×2 = 139, ends in 9). A number that fails is not an IMO number.
 */
export function validImo(digits: string): boolean {
  if (!/^\d{7}$/.test(digits)) return false;
  const sum = [7, 6, 5, 4, 3, 2].reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
  return sum % 10 === Number(digits[6]);
}

/** Painted words that are not a vessel's name (the operator, warnings, the port). */
const NOT_A_NAME = new Set(['RNLI', 'LIFEBOAT', 'POLICE', 'PILOT', 'COASTGUARD', 'BORDER FORCE', 'DANGER', 'KEEP CLEAR', 'NO STEP',
  'FERRY', 'FERRIES', 'TUG', 'CREW', 'PASSENGERS', 'EXIT', 'LONDON', 'SOUTHAMPTON', 'PORTSMOUTH', 'DOVER', 'HOLYHEAD', 'POOLE']);

/**
 * A vessel's markings in one line: an IMO number that passes its check ("IMO 9074729"), or a name painted on the hull
 * (letters and spaces, 3 to 30 characters, not a common operator or warning word). Plate shapes are dropped first.
 */
export function findVesselMarkings(text: string): Marking[] {
  const upper = text.toUpperCase().replace(/\s+/g, ' ').trim();
  if (looksLikeNumberPlate(upper.replace(/[^A-Z0-9]/g, ''))) return [];
  const imo = /\bIMO\s*:?\s*(\d{7})\b/.exec(upper);
  if (imo) return validImo(imo[1]) ? [{ value: `IMO ${imo[1]}`, format: 'imo' }] : [];
  const name = upper.replace(/[^A-Z '&.-]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 30 || name !== upper || !/[A-Z]{3}/.test(name) || NOT_A_NAME.has(name)) return [];
  return [{ value: name, format: 'hull-name' }];
}

// Current UK number plates (AB12 CDE) and Irish plates (12-D-3456, 191-KY-12). No aircraft format below has these shapes.
// Older UK plates (ABC 123, A123 BCD) do share shapes with serials and N-numbers, so for them the first guard is the one
// that counts: text is only read from an aircraft photo, inside the aircraft.
const PLATES = [/^[A-Z]{2}\d{2}[A-Z]{3}$/, /^\d{2,3}[A-Z]{1,2}\d{1,6}$/];
/** True for text shaped like a road number plate. Such text is never kept, stored or looked up. */
export function looksLikeNumberPlate(compact: string): boolean {
  return PLATES.some((pattern) => pattern.test(compact));
}

/**
 * UK military serials: two letters and three digits (ZJ910, ZK301, ZM400). The letters C, I, O, Q, U and Y are not used.
 * Kept to the prefix letters of serials in service or display now (X, Z), so an old airframe on a museum gate may be missed
 * rather than a stray word being read as a serial.
 */
const UK_MILITARY = /^[XZ][ABD-HJ-NPR-TV-XZ]\d{3}$/;
/** N-numbers: N, then 1 to 5 characters: a digit 1–9 first, then digits, ending in at most two letters (never I or O). */
const US_CIVIL = /^N[1-9](?:\d{0,4}|\d{0,3}[A-HJ-NP-Z]|\d{0,2}[A-HJ-NP-Z]{2})$/;

/**
 * Every marking in one line of OCR text. Unknown or doubtful text gives nothing: a marking is never "corrected" into
 * being valid beyond the two look-alikes OCR commonly swaps inside the digit part of a serial (O for 0, I for 1).
 */
export function findMarkings(text: string): Marking[] {
  const out: Marking[] = [];
  const seen = new Set<string>();
  const add = (marking: Marking) => { if (!seen.has(marking.value)) { seen.add(marking.value); out.push(marking); } };
  const upper = text.toUpperCase();
  // A whole line shaped like a number plate ("AB12 CDE") is dropped before it is split into words.
  if (looksLikeNumberPlate(upper.replace(/[^A-Z0-9]/g, ''))) return [];
  for (const raw of upper.split(/[\s,;:/|]+/)) {
    const token = raw.replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '');
    if (token.length < 4 || token.length > 8) continue;
    const compact = token.replace(/-/g, '');
    if (looksLikeNumberPlate(compact)) continue;
    if (/^G-?[A-Z]{4}$/.test(token)) { add({ value: `G-${compact.slice(1)}`, format: 'uk-civil' }); continue; }
    if (/^EI-?[A-Z]{3}$/.test(token)) { add({ value: `EI-${compact.slice(2)}`, format: 'irish-civil' }); continue; }
    if (US_CIVIL.test(compact)) { add({ value: compact, format: 'us-civil' }); continue; }
    const serial = compact.length === 5 ? compact.slice(0, 2) + compact.slice(2).replace(/O/g, '0').replace(/I/g, '1') : compact;
    if (UK_MILITARY.test(serial)) { add({ value: serial, format: 'uk-military' }); continue; }
  }
  return out;
}
