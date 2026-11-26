/**
 * The KESTREL1 key a buyer keeps (src/core/licence.ts checks it). It names the licence record the purchase created, so
 * the same device limit, refund and revoke apply whether a device uses the key or the account. It carries the major
 * version bought, so it never unlocks a later paid version. Keys hold no personal data.
 */
import crypto from 'node:crypto';
import type { LicenceRecord } from './store.ts';

/** Bought outright: a verified one-off payment for Pro that never expires and is still active. */
export const ownsLicence = (l: Pick<LicenceRecord, 'paid' | 'plan' | 'validUntilMs' | 'status'>) =>
  l.paid && l.plan === 'paid' && l.validUntilMs === null && l.status === 'active';

export function mintLicenceKey(licence: Pick<LicenceRecord, 'licenceId' | 'majorVersion'>, privateKey: crypto.KeyObject, nowMs: number): string {
  const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: licence.licenceId, issuedAt: nowMs, major: licence.majorVersion }));
  return `KESTREL1.${details.toString('base64url')}.${crypto.sign(null, details, privateKey).toString('base64url')}`;
}

/** The email that carries a buyer's key. Plain words; the key is on its own line so it copies cleanly. */
export function licenceKeyMail(key: string, majorVersion: number): { subject: string; text: string } {
  return {
    subject: `Your InFlight ${majorVersion} Pro licence key`,
    text: [
      `Thank you for buying InFlight ${majorVersion} Pro. It is yours to keep.`,
      'Your licence key:',
      key,
      'Signing in to InFlight adds this key for you. You can also paste it in Settings, Account, Licence key. It works with no internet connection and no account.',
      `It covers InFlight ${majorVersion} on up to 5 of your devices. To use it on another device, free one in Settings, Account. A device you have not used for 30 days is freed for you when you add a new one. You can free devices yourself up to 3 times a year, and support can help if you need more.`,
      'Keep this email. If you ask for a refund, the key stops working.',
    ].join('\n\n'),
  };
}
