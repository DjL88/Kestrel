import { faaRegister, type FaaRegister } from '../core/aircraftRegister';

let faa: Promise<FaaRegister> | null = null;

/** The offline FAA copy (5.4 MB, public domain), loaded only when an N-number has actually been read. */
export function loadFaaRegister(): Promise<FaaRegister> {
  faa ??= import('../assets/registers/faa.json').then((file) => faaRegister(file.default)).catch((error) => { faa = null; throw error; });
  return faa;
}
