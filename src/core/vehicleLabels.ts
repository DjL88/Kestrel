import labelFile from '../assets/vehicle/labels.json';
import type { VehicleLabels } from './vehicleRecognition';

/** The committed vehicle kinds and types (ids, families, prompts). Small enough to ship with every build. */
export const VEHICLE_LABELS = labelFile as VehicleLabels;
