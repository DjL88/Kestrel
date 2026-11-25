/**
 * Live presence for shared projects (#1387 C04). Cursors and "who is looking at which photo" go through Firebase
 * Realtime Database, which removes a person's entry by itself when their connection drops (onDisconnect). The control
 * plane decides membership, so it hands each member a short-lived Firebase custom token for ONE project; the database
 * rules (database.rules.json at the repository root) let that token write only its own entry and read only that
 * project. Nothing is kept: an entry is overwritten as the cursor moves and removed on disconnect.
 *
 * The token is signed by the service's own Google service account through the IAM Credentials API, so no private key
 * is stored anywhere. That needs the service account to hold "Service Account Token Creator" on itself.
 */
import { sha256Hex } from './crypto.ts';

export const FIREBASE_CUSTOM_TOKEN_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
export const PRESENCE_TOKEN_TTL_S = 3600;

export interface PresenceClaims { /** project */ p: string; /** role */ r: string }

export interface PresenceSigner {
  /** The Realtime Database URL the app connects to, e.g. https://<name>.europe-west1.firebasedatabase.app */
  databaseUrl: string;
  sign(uid: string, claims: PresenceClaims, issuedAtS: number): Promise<string>;
}

/** A stable presence id that does not reveal the account id. */
export const presenceUid = (accountId: string) => `kcp_${sha256Hex(`presence:${accountId}`).slice(0, 28)}`;

export function customTokenPayload(serviceAccount: string, uid: string, claims: PresenceClaims, issuedAtS: number) {
  return { iss: serviceAccount, sub: serviceAccount, aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE, iat: issuedAtS, exp: issuedAtS + PRESENCE_TOKEN_TTL_S, uid, claims };
}

/** Signs with IAM Credentials `signJwt` using the metadata server's access token (Cloud Run). */
export class IamPresenceSigner implements PresenceSigner {
  constructor(
    readonly databaseUrl: string,
    private readonly serviceAccount: string,
    private readonly accessToken: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async sign(uid: string, claims: PresenceClaims, issuedAtS: number): Promise<string> {
    const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(this.serviceAccount)}:signJwt`;
    const r = await this.fetcher(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: JSON.stringify(customTokenPayload(this.serviceAccount, uid, claims, issuedAtS)) }),
    });
    if (!r.ok) throw new Error(`signJwt ${r.status}`);
    return ((await r.json()) as { signedJwt: string }).signedJwt;
  }
}
