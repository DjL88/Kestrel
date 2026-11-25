import { VEHICLE_LABELS } from '../core/vehicleLabels';
import { vehicleVectors, type VehicleLabels, type VehicleVectors } from '../core/vehicleRecognition';

let loading: Promise<{ labels: VehicleLabels; vectors: VehicleVectors }> | null = null;

/** The vehicle kind and type vectors, loaded once. They read the category gate's own CLIP embedding; no other model. */
export function loadVehicleData(): Promise<{ labels: VehicleLabels; vectors: VehicleVectors }> {
  loading ??= import('../assets/vehicle/vectors.json')
    .then((file) => ({ labels: VEHICLE_LABELS, vectors: vehicleVectors(file.default, VEHICLE_LABELS) }))
    .catch((error) => { loading = null; throw error; });
  return loading;
}
