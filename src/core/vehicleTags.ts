import type { MarkingFormat } from './aircraftRegistration';
import { mergePhotoTags, type PhotoTag, type TagSource } from './photoTags';
import type { PhotoFrame } from './types';
import { validVehicleReading, type VehicleLabels, type VehicleReading, type VehicleWords } from './vehicleRecognition';

/**
 * The vehicles lane's tags in the shared photo tag store (photoTags.ts, #1477). The structured reading on the photo
 * (`PhotoFrame.vehicle`: guardian state, register match, confidence) stays the source of truth; these tags are derived
 * from it, so search, the Tags filter and every other lane see one store.
 *
 * Ids: `vehicle.family.air`, `vehicle.kind.military-jet`, `vehicle.type.typhoon`, `vehicle.registered.cessna-172s`,
 * `marking.reg.n172sp`, `marking.serial.zk301`, `marking.race.46`, `marking.name.pride-of-kent`, `marking.imo.9074729`.
 * Kinds and families take their words from the `vehicles` i18n area (`vehicleTagWords`); types, register records and
 * markings are proper names, carried in `name` and never translated. A look-alike guess is `hedged` ("probably").
 * Nothing the guardian held, nothing below threshold and nothing for a photo marked "not a vehicle" becomes a tag.
 */
export const VEHICLES_LANE = 'vehicles';
export const VEHICLE_FACETS = ['vehicle', 'marking'] as const;

const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const MARKING_KEY: Record<MarkingFormat, string> = {
  'uk-civil': 'reg', 'irish-civil': 'reg', 'us-civil': 'reg', 'uk-military': 'serial', 'race-number': 'race', imo: 'imo', 'hull-name': 'name',
};

/** The tags one reading gives. */
export function vehicleTags(reading: VehicleReading | null, labels: VehicleLabels): PhotoTag[] {
  if (!reading || reading.heldFamily) return [];
  const person = reading.source === 'person';
  // The person's own choice is 'user' (never hedged); a carried reading names the frame it came from.
  const base: Pick<PhotoTag, 'source' | 'fromFrameId'> = reading.carriedFrom
    ? { source: 'burst', fromFrameId: reading.carriedFrom }
    : { source: (person ? 'user' : 'clip') as TagSource };
  const hedged = person ? {} : { hedged: true };
  const tags: PhotoTag[] = [{ id: `vehicle.family.${reading.family}`, facet: 'vehicle', ...base }];
  if (reading.kind) tags.push({ id: `vehicle.kind.${reading.kind}`, facet: 'vehicle', ...base, ...hedged });
  const type = reading.type ? labels.types.find((entry) => entry.id === reading.type) : undefined;
  if (type) tags.push({ id: `vehicle.type.${type.id}`, facet: 'vehicle', name: type.name, ...base, ...hedged });
  const { marking, registered } = reading;
  if (marking) {
    const key = slug(marking.value);
    if (key) tags.push({ id: `marking.${MARKING_KEY[marking.format]}.${key}`, facet: 'marking', name: marking.value, ...(reading.carriedFrom ? base : { source: 'ocr' }) });
  }
  if (reading.imo) tags.push({ id: `marking.imo.${reading.imo.slice(4)}`, facet: 'marking', name: reading.imo, ...(reading.carriedFrom ? base : { source: 'ocr' }) });
  if (registered && !person) {
    const key = slug(registered.type);
    if (key) tags.push({ id: `vehicle.registered.${key}`, facet: 'vehicle', name: registered.type, ...(reading.carriedFrom ? base : { source: 'register' }), ...(registered.exact ? {} : { hedged: true }) });
  }
  return tags;
}

/** Bring a photo's vehicle tags in line with its reading (none when it has no reading or was marked "not a vehicle"). */
export function syncVehicleTags<F extends PhotoFrame>(frame: F, labels: VehicleLabels): F {
  const reading = frame.vehicleDeclined ? null : validVehicleReading(frame.vehicle, labels);
  const tags = vehicleTags(reading, labels);
  // A photo the lane never tagged and has nothing for is left alone (no empty tag set is written).
  if (!tags.length && !frame.photoTags?.byLane?.[VEHICLES_LANE]) return frame;
  return mergePhotoTags(frame, VEHICLES_LANE, VEHICLE_FACETS, tags, `vehicles-${labels.version}`);
}

/** The same for many frames; the same array when nothing changed. */
export function syncAllVehicleTags<F extends PhotoFrame>(frames: readonly F[], labels: VehicleLabels): F[] {
  let changed = false;
  const out = frames.map((frame) => {
    const next = syncVehicleTags(frame, labels);
    if (next !== frame) changed = true;
    return next;
  });
  return changed ? out : frames as F[];
}

/** Words for a `vehicle.family.*` or `vehicle.kind.*` id, chained into the photo tags area's labels. */
export function vehicleTagWords(id: string, words: Pick<VehicleWords, 'families' | 'kinds'>): string | undefined {
  const [, level, value] = id.split('.');
  if (level === 'family') return (words.families as Record<string, string>)[value];
  if (level === 'kind') return words.kinds[value];
  return undefined;
}
