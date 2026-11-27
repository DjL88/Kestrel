// Pure decisions for the launch welcome screen. No DOM, React or providers.

export type LaunchProfile = { signedIn: true; displayName: string | null; initial: string | null };
/** editedAt is an ISO date. */
export type LastProject = {
  id: string; name: string; photoCount: number; editedAt: string;
  /** Up to three references to previews already stored on this device, shown on the "pick up" card (never the pictures). */
  thumbs?: { keys: string[]; developVersion: number };
};
export type WelcomeState = 'first' | 'signedIn' | 'guest';
export type WelcomeInput = {
  profile: LaunchProfile | null;
  accountInLicence: boolean;
  launchedBefore: boolean;
  hasProjects: boolean;
};

export function chooseWelcome(input: WelcomeInput): WelcomeState {
  if (input.profile || input.accountInLicence) return 'signedIn';
  if (input.launchedBefore || input.hasProjects) return 'guest';
  return 'first';
}

/** Only guests who chose to skip go straight to their work. */
export function shouldSkipWelcome(state: WelcomeState, skipChosen: boolean): boolean {
  return state === 'guest' && skipChosen;
}

/** Apple's "Hide My Email" addresses: the part before @ is random letters, never a name to greet someone by. */
const PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';

export function profileFromSession(session: { email?: string; displayName?: string }): LaunchProfile {
  const name = session.displayName?.trim();
  const [user, domain] = (session.email ?? '').split('@');
  const local = domain?.trim().toLowerCase() === PRIVATE_RELAY_DOMAIN ? undefined : user?.trim();
  const displayName = name || local || null;
  const first = displayName ? Array.from(displayName)[0] : undefined;
  return { signedIn: true, displayName, initial: first ? first.toUpperCase() : null };
}

export type EmailFailure = 'wrong-or-unknown' | 'in-use' | 'weak-password' | 'invalid-email' | 'offline' | 'other';

export function emailNextStep(
  stage: 'signIn' | 'create',
  failure: EmailFailure,
): 'offer-create' | 'say-wrong-password' | 'show-error' {
  if (stage === 'signIn' && failure === 'wrong-or-unknown') return 'offer-create';
  if (stage === 'create' && failure === 'in-use') return 'say-wrong-password';
  return 'show-error';
}
