import type { SignInProvider } from './cloudInterfaces';

export type SignInPlatform = 'web' | 'desktop' | 'ios' | 'android';

export interface SignInOption { provider: SignInProvider; label: string; available: boolean; reason?: string }

/**
 * Which sign-in buttons to show and whether each works here. Apple requires Sign in with Apple wherever another
 * third-party sign-in is offered, so the two always appear together. Unavailable is explained, never hidden.
 * The desktop app signs in with Google through the person's normal browser when the build has a Google desktop client
 * (`desktopGoogle`); Apple and the phone apps' native flows are not built yet. Email/password is a separate route.
 */
export function signInOptions(platform: SignInPlatform, configured: boolean, desktopGoogle = false): SignInOption[] {
  if (!configured) {
    const reason = 'Sign-in is not set up in this build.';
    return [
      { provider: 'google', label: 'Continue with Google', available: false, reason },
      { provider: 'apple', label: 'Continue with Apple', available: false, reason },
    ];
  }
  if (platform === 'web') {
    return [
      { provider: 'google', label: 'Continue with Google', available: true },
      { provider: 'apple', label: 'Continue with Apple', available: true },
    ];
  }
  if (platform === 'desktop' && desktopGoogle) {
    return [
      { provider: 'google', label: 'Continue with Google', available: true },
      { provider: 'apple', label: 'Continue with Apple', available: false, reason: 'Apple sign-in is not built yet for the desktop app. Use Google, or email and password.' },
    ];
  }
  const reason = 'Google and Apple sign-in are not built yet for installed apps. Use email and password here, or sign in on the web.';
  return [
    { provider: 'google', label: 'Continue with Google', available: false, reason },
    { provider: 'apple', label: 'Continue with Apple', available: false, reason },
  ];
}
