import type { SignInProvider } from './cloudInterfaces';

export type SignInPlatform = 'web' | 'desktop' | 'ios' | 'android';

export interface SignInOption { provider: SignInProvider; label: string; available: boolean; reason?: string }

/**
 * Which sign-in buttons to show and whether each works here. Apple requires Sign in with Apple wherever another
 * third-party sign-in is offered, so the two always appear together. Unavailable is explained, never hidden.
 * Native Google/Apple flows are not built yet; configured email/password sign-in is a separate route.
 */
export function signInOptions(platform: SignInPlatform, configured: boolean): SignInOption[] {
  const reason = !configured
    ? 'Sign-in is not set up in this build.'
    : platform === 'web' ? undefined : 'Google and Apple sign-in are not built yet for installed apps. Use email and password here, or sign in on the web.';
  const available = reason === undefined;
  return [
    { provider: 'google', label: 'Continue with Google', available, reason },
    { provider: 'apple', label: 'Continue with Apple', available, reason },
  ];
}
