import type { PhotoFrame } from './types';
import { validVehicleReading, type VehicleLabels, type VehicleReading } from './vehicleRecognition';

/**
 * Vehicle and aircraft recognition, step 4: bursts. A Mach Loop pass is dozens of frames of the same aircraft, so the best
 * reading in a burst is carried to every frame of it, and one correction fixes the whole burst.
 *
 * Which reading is best: the person's own choice, then an exact register record, then a serial-block match, then one the
 * guardian agreed with, then the surest look-alike guess. A reading the guardian held, or one carried from elsewhere, is
 * never the source. A frame's own choice by the person is never overwritten by a carried one. Pure: no model runs here.
 */
function strength(reading: VehicleReading): number {
  if (reading.source === 'person') return 5;
  if (reading.guardian === 'held') return -1;
  if (reading.registered?.exact) return 4;
  if (reading.registered) return 3;
  return (reading.guardian === 'agreed' ? 2 : 1) + (reading.kindProbability ?? 0) / 10;
}

/** The burst a frame belongs to, or null when it is on its own or the person split the burst. */
function burstOf(frame: PhotoFrame): string | null {
  return frame.removedAt == null && !frame.burstUngrouped && frame.burstGroupId && frame.burstCount > 1 ? frame.burstGroupId : null;
}

export function carryVehicleReadings(frames: readonly PhotoFrame[], labels: VehicleLabels): PhotoFrame[] {
  const best = new Map<string, { frame: PhotoFrame; reading: VehicleReading; score: number }>();
  for (const frame of frames) {
    const burst = burstOf(frame);
    const reading = burst && !frame.vehicleDeclined ? validVehicleReading(frame.vehicle, labels) : null;
    if (!burst || !reading || reading.carriedFrom || reading.heldFamily) continue;
    const score = strength(reading);
    if (score < 0) continue;
    const current = best.get(burst);
    if (!current || score > current.score) best.set(burst, { frame, reading, score });
  }
  if (!best.size) return frames as PhotoFrame[];
  let changed = false;
  const out = frames.map((frame) => {
    const burst = burstOf(frame);
    const source = burst ? best.get(burst) : undefined;
    if (!source || source.frame.id === frame.id || frame.vehicleDeclined) return frame;
    const own = validVehicleReading(frame.vehicle, labels);
    if (own?.source === 'person' && !own.carriedFrom) return frame; // the person chose this frame's name
    if (own && !own.carriedFrom && strength(own) >= source.score) return frame;
    const carried: VehicleReading = { ...source.reading, carriedFrom: source.frame.id };
    if (JSON.stringify(own) === JSON.stringify(carried)) return frame;
    changed = true;
    return { ...frame, vehicle: carried };
  });
  return changed ? out : frames as PhotoFrame[];
}

/** What the person chose: a kind with an optional make or type, or "not a vehicle". */
export type VehicleChoice = { kind: string; type?: string } | 'not-a-vehicle';

/**
 * The person's correction, for one photo or for every frame of its burst. Their choice is then the reading (no "probably")
 * and the scan never adds one back. Text read from the aircraft is kept; a register match that disagrees is dropped.
 */
export function correctVehicle(frames: readonly PhotoFrame[], frameId: string, choice: VehicleChoice, wholeBurst: boolean, labels: VehicleLabels): PhotoFrame[] {
  const target = frames.find((frame) => frame.id === frameId);
  if (!target) return frames as PhotoFrame[];
  const burst = wholeBurst ? burstOf(target) : null;
  const kind = choice === 'not-a-vehicle' ? undefined : labels.kinds.find((entry) => entry.id === choice.kind && !entry.decoy);
  if (choice !== 'not-a-vehicle' && (!kind || (choice.type && !labels.types.some((entry) => entry.id === choice.type && entry.kind === kind.id)))) return frames as PhotoFrame[];
  return frames.map((frame) => {
    if (frame.removedAt != null || (frame.id !== frameId && (!burst || burstOf(frame) !== burst))) return frame;
    if (choice === 'not-a-vehicle' || !kind) {
      const { vehicle: _removed, ...rest } = frame;
      return { ...rest, vehicleDeclined: true, speciesChecked: true };
    }
    const own = validVehicleReading(frame.vehicle, labels);
    const marking = kind.family === 'air' ? own?.marking : undefined;
    const reading: VehicleReading = {
      schema: 1, family: kind.family, kind: kind.id, ...(choice.type ? { type: choice.type } : {}), source: 'person', labelsVersion: labels.version,
      ...(marking ? { marking } : {}),
    };
    const { vehicleDeclined: _declined, ...rest } = frame;
    return { ...rest, vehicle: reading, speciesChecked: true };
  });
}
