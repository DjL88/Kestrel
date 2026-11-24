/** In-memory ZIP creates both compressed chunks and a final Blob.
 * Leave ample headroom for rendering and the original image caches.
 * This is a protective limit, not a measurement of available system RAM. */
const MiB = 1024 * 1024;
export function zipMemoryLimit(device: { mobile?: boolean; deviceMemoryGiB?: number } = {}): number {
  const constrained = device.mobile === true ||
    (Number.isFinite(device.deviceMemoryGiB) && device.deviceMemoryGiB! <= 4);
  return constrained ? 96 * MiB : 320 * MiB;
}

/** Fail before another file is retained: a ZIP must never silently omit photos. */
export function requireZipCapacity(heldBytes: number, nextBytes: number, limitBytes: number): number {
  if (![heldBytes, nextBytes, limitBytes].every(value => Number.isSafeInteger(value) && value >= 0) ||
      limitBytes === 0 || heldBytes > limitBytes || nextBytes > limitBytes - heldBytes) {
    throw new Error('This ZIP is too large for safe in-memory export on this device. No incomplete archive was delivered. On desktop, choose Export to folder; otherwise export fewer photographs at a time.');
  }
  return heldBytes + nextBytes;
}
