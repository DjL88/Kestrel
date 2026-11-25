import { VEHICLE_LABELS } from '../core/vehicleLabels';
import { guardVehicle, guardianQuestion, readYesNo } from '../core/vehicleGuardian';
import type { VehicleReading } from '../core/vehicleRecognition';
import { source as english } from '../i18n/areas/vehicles/source';
import { describePhoto, hasLocalVision, localVisionStatus } from './localVision';

/**
 * Ask the on-device vision model (SmolVLM2 in the desktop app, no network) about a vehicle reading before it is shown.
 * Without the model, or when it does not answer plainly, the reading is unchanged: no opinion never changes a result.
 */
export async function guardVehicleOnDevice(reading: VehicleReading, picture: HTMLCanvasElement): Promise<VehicleReading> {
  const question = guardianQuestion(reading, VEHICLE_LABELS, english.kinds, english.families);
  if (!question || !hasLocalVision()) return reading;
  try {
    if (!(await localVisionStatus())?.installed) return reading;
    const jpeg = await new Promise<Blob | null>((resolve) => picture.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) return reading;
    const answer = await describePhoto(jpeg, question.text);
    return guardVehicle(reading, question, answer.usable ? readYesNo(answer.text) : 'unsure');
  } catch {
    return reading;
  }
}
