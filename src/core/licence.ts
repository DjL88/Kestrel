/**
 * Offline licence keys. A key is "KESTREL1.<details>.<signature>": the details are a small statement (which plan, a random
 * id, when it was issued) signed with a private key only the owner holds. The app checks the signature against the public
 * key below, so a key works with no internet, no account and no server. It holds no personal data: the buyer's email stays
 * with the payment provider. Keys can be shared; that is accepted rather than policed.
 */
export const LICENCE_PUBLIC_KEY = 'Wyl4gmifZParQ8SYhc6rjvDRlAf0eii7FwHI8o360gM=';

export interface LicenceDetails { v: 1; plan: 'paid'; id: string; issuedAt: number }
export type LicenceCheck = { ok: true; details: LicenceDetails } | { ok: false; reason: 'format' | 'signature' | 'unsupported' };

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const base = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};
const fromBase64 = (text: string) => fromBase64Url(text);

/** Check a key. Never throws: a damaged or foreign key is just "not valid". Safe to call with anything a person pastes. */
export async function verifyLicence(key: string, publicKey: string = LICENCE_PUBLIC_KEY): Promise<LicenceCheck> {
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'KESTREL1') return { ok: false, reason: 'format' };
  let body: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>, details: LicenceDetails;
  try {
    body = fromBase64Url(parts[1]);
    signature = fromBase64Url(parts[2]);
    details = JSON.parse(new TextDecoder().decode(body)) as LicenceDetails;
  } catch { return { ok: false, reason: 'format' }; }
  if (details?.v !== 1 || details.plan !== 'paid' || typeof details.id !== 'string' || !Number.isSafeInteger(details.issuedAt)) return { ok: false, reason: 'format' };
  try {
    const imported = await crypto.subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, imported, signature, body) ? { ok: true, details } : { ok: false, reason: 'signature' };
  } catch {
    // This device's browser engine cannot check Ed25519. The key may be fine, so say so rather than call it wrong.
    return { ok: false, reason: 'unsupported' };
  }
}

export const LICENCE_MESSAGES: Record<'format' | 'signature' | 'unsupported', string> = {
  format: 'That does not look like an InFlight licence key. Copy it exactly as it was emailed to you.',
  signature: 'That key was not recognised. Check it was copied in full, or contact support with your receipt.',
  unsupported: 'This device cannot check licence keys yet. Update your system or browser, or use the desktop app.',
};
