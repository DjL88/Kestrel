/**
 * One InFlight account, however the person signs in (owner, 25 Nov 2026). Google, Apple and email-and-password are ways
 * into the same Firebase user, linked on purpose ("account linking"), never a silent second account.
 *
 * Pure: turns Firebase's provider ids and error codes into plain outcomes the Settings screen words in every language.
 */
export type SignInMethod = 'google' | 'apple' | 'password';

const BY_PROVIDER: Record<string, SignInMethod> = { 'google.com': 'google', 'apple.com': 'apple', password: 'password' };

/** The ways this account can sign in, in a stable order. Unknown providers are left out. */
export function methodsFromProviderIds(providerIds: readonly string[]): SignInMethod[] {
  const found = new Set(providerIds.map((id) => BY_PROVIDER[id]).filter((m): m is SignInMethod => m !== undefined));
  return (['google', 'apple', 'password'] as const).filter((m) => found.has(m));
}

/** The ways that could still be added here (Apple and Google only where the build can open them). */
export function methodsToAdd(have: readonly SignInMethod[], available: readonly SignInMethod[]): SignInMethod[] {
  return available.filter((m) => !have.includes(m));
}

export type LinkingProblem =
  /** The email already has an account that signs in another way: sign in that way once and this one is added to it. */
  | 'use-existing-method'
  /** That Google or Apple sign-in (or email) already belongs to a different InFlight account. Nothing is changed. */
  | 'belongs-to-other-account'
  /** Already on this account. */
  | 'already-added'
  /** Firebase wants a fresh sign-in before adding a way in. */
  | 'needs-recent-sign-in';

export function linkingProblem(code: string): LinkingProblem | null {
  switch (code) {
    case 'auth/account-exists-with-different-credential': return 'use-existing-method';
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use': return 'belongs-to-other-account';
    case 'auth/provider-already-linked': return 'already-added';
    case 'auth/requires-recent-login': return 'needs-recent-sign-in';
    default: return null;
  }
}

/** A sign-in or add that stopped for a linking reason, so the screen can explain it in the person's language. */
export class LinkingError extends Error {
  constructor(readonly problem: LinkingProblem) { super(problem); this.name = 'LinkingError'; }
}
