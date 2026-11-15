const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 worked out a piece at a time, so a large file can be checked as it arrives without ever holding a second copy.
 * It works in every browser, including plain http on a local network where the built-in version is switched off.
 */
export class Sha256Stream {
  private readonly h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly w = new Uint32Array(64);
  private readonly pending = new Uint8Array(64);
  private filled = 0;
  private length = 0;

  private block(bytes: Uint8Array, offset: number) {
    const { w, h } = this;
    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < 16; i += 1) { const at = offset + i * 4; w[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0; }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }

  update(chunk: Uint8Array): this {
    this.length += chunk.length;
    let at = 0;
    if (this.filled) {
      const take = Math.min(64 - this.filled, chunk.length);
      this.pending.set(chunk.subarray(0, take), this.filled);
      this.filled += take;
      at = take;
      if (this.filled === 64) { this.block(this.pending, 0); this.filled = 0; }
    }
    for (; at + 64 <= chunk.length; at += 64) this.block(chunk, at);
    if (at < chunk.length) { this.pending.set(chunk.subarray(at), 0); this.filled = chunk.length - at; }
    return this;
  }

  /** The finished hash as hex. Call once, after the last piece. */
  digest(): string {
    const bits = this.length * 8;
    const tail = new Uint8Array(this.filled + 1 + ((119 - this.filled) % 64) + 8);
    tail.set(this.pending.subarray(0, this.filled));
    tail[this.filled] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(tail.length - 4, bits >>> 0);
    for (let at = 0; at < tail.length; at += 64) this.block(tail, at);
    return [...this.h].map((word) => word.toString(16).padStart(8, '0')).join('');
  }
}

/** Plain SHA-256 for browsers that do not offer crypto.subtle (plain http on a local network). */
export function sha256Plain(input: Uint8Array): string {
  return new Sha256Stream().update(input).digest();
}

/** SHA-256 as hex, using the browser's own implementation when it is available. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return sha256Plain(new Uint8Array(bytes));
}
