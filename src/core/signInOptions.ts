import type { SignInProvider } from './cloudInterfaces';

export type SignInPlatform = 'web' | 'desktop' | 'ios' | 'android';

export interface SignInOption { provider: SignInProvider; label: string; available: boolean; reason?: string }

/**
 * Which sign-in buttons to show and whether each works here. Apple requires Sign in with Apple wherever another
 * third-party sign-in is offered, so the two always appear together. Unavailable is explained, never hidden.
 * Native (system-browser or platform) flows are not built yet, so only the web is available.
 */
export function signInOptions(platform: SignInPlatform, configured: boolean): SignInOption[] {
  const reason = !configured
    ? 'Sign-in is not set up in this build.'
    : platform === 'web' ? undefined : 'Sign-in on the installed apps is not built yet. You can sign in from the web version.';
  const available = reason === undefined;
  return [
    { provider: 'google', label: 'Continue with Google', available, reason },
    { provider: 'apple', label: 'Continue with Apple', available, reason },
  ];
}
