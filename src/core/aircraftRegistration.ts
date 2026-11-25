/**
 * Vehicle and aircraft recognition, step 2: what painted text on an AIRCRAFT may be a registration or military serial.
 *
 * Text is only ever read from a photo whose vehicle reading is an aircraft (`mayReadMarkings`), so a car's number plate is
 * never read. As a second guard, anything shaped like a UK or Irish number plate is dropped even on an aircraft, and only
 * the formats below are kept. Pure and deterministic: OCR output comes in as text, nothing is looked up here.
 */
import type { VehicleReading } from './vehicleRecognition';

export type MarkingFormat = 'uk-civil' | 'irish-civil' | 'us-civil' | 'uk-military';

export interface Marking {
  /** Normalised: upper case, with the country's dash ("G-EZAA", "EI-DCL", "N172SP", "ZK301"). */
  value: string;
  format: MarkingFormat;
}

/** Only photos read as aircraft are ever read for text. A road, rail or water vehicle never is. */
export function mayReadMarkings(reading: VehicleReading | null | undefined): boolean {
  return reading?.family === 'air';
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
