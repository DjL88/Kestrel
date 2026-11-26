import type { SignInProvider } from './cloudInterfaces';

export type SignInPlatform = 'web' | 'desktop' | 'ios' | 'android';

export interface SignInOption { provider: SignInProvider; label: string; available: boolean; reason?: string }

/**
 * Which sign-in buttons to show and whether each works here. Apple requires Sign in with Apple wherever another
 * third-party sign-in is offered, so the two always appear together. Unavailable is explained, never hidden.
 * The desktop app signs in through the person's normal browser: Google when the build has a Google desktop client
 * (`desktopGoogle`), Apple when it has the website address that hosts the Apple sign-in page (`desktopApple`). The phone
 * apps' native flows are not built yet. Email/password is a separate route.
 */
export function signInOptions(platform: SignInPlatform, configured: boolean, desktopGoogle = false, desktopApple = false, microsoft = false, desktopMicrosoft = false): SignInOption[] {
  const options = googleAndApple(platform, configured, desktopGoogle, desktopApple);
  return microsoft ? [...options, microsoftOption(platform, configured, desktopMicrosoft)] : options;
}

/**
 * Sign in with Microsoft (personal accounts and work or school Microsoft 365 accounts), only in builds that switch it on
 * (VITE_MICROSOFT_SIGN_IN), because Firebase refuses it until the Microsoft provider is enabled in its console. It opens
 * Firebase's pop-up on the web. The desktop app opens Microsoft's page in the person's browser only when its own flag is on
 * (`desktopMicrosoft`, see microsoftSignIn.ts), because a real installed build has not yet proved Firebase accepts it.
 */
function microsoftOption(platform: SignInPlatform, configured: boolean, desktopMicrosoft: boolean): SignInOption {
  const label = 'Continue with Microsoft';
  if (!configured) return { provider: 'microsoft', label, available: false, reason: 'Sign-in is not set up in this build.' };
  if (platform === 'web' || (platform === 'desktop' && desktopMicrosoft)) return { provider: 'microsoft', label, available: true };
  return { provider: 'microsoft', label, available: false, reason: 'Microsoft sign-in works on the web version for now. Use another way here, or sign in on the web.' };
}

function googleAndApple(platform: SignInPlatform, configured: boolean, desktopGoogle: boolean, desktopApple: boolean): SignInOption[] {
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
  if (platform === 'desktop' && (desktopGoogle || desktopApple)) {
    const missing = (name: string, other: string) => `${name} sign-in is not set up in this build of the desktop app. Use ${other}, or email and password.`;
    return [
      desktopGoogle ? { provider: 'google', label: 'Continue with Google', available: true } : { provider: 'google', label: 'Continue with Google', available: false, reason: missing('Google', 'Apple') },
      desktopApple ? { provider: 'apple', label: 'Continue with Apple', available: true } : { provider: 'apple', label: 'Continue with Apple', available: false, reason: missing('Apple', 'Google') },
    ];
  }
  const reason = 'Google and Apple sign-in are not built yet for installed apps. Use email and password here, or sign in on the web.';
  return [
    { provider: 'google', label: 'Continue with Google', available: false, reason },
    { provider: 'apple', label: 'Continue with Apple', available: false, reason },
  ];
}

/** The kind of device, from the browser's user agent, used only to choose which sign-in to suggest first. */
export type DeviceFamily = 'windows' | 'apple' | 'android' | 'other';

export function deviceFamily(userAgent: string): DeviceFamily {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(userAgent)) return 'apple';
  if (/Windows/i.test(userAgent)) return 'windows';
  return 'other';
}

const PREFERRED: Record<DeviceFamily, SignInProvider> = { windows: 'microsoft', apple: 'apple', android: 'google', other: 'google' };

/**
 * One suggested button for this device (Windows: Microsoft, Android: Google, Mac, iPhone and iPad: Apple), with the rest
 * behind "Other ways to sign in" (owner, 26 Nov 2026). When the device's choice cannot be used here, the first one that
 * can is suggested instead. Nothing is removed: every option, with its reason, stays under "other".
 */
export function suggestedSignIn(options: readonly SignInOption[], family: DeviceFamily): { suggested: SignInOption | null; other: SignInOption[] } {
  const suggested = options.find((o) => o.provider === PREFERRED[family] && o.available) ?? options.find((o) => o.available) ?? null;
  return { suggested, other: options.filter((o) => o !== suggested) };
}

const FIREBASE_PROVIDERS: Record<string, SignInProvider> = {
  'google.com': 'google', 'apple.com': 'apple', 'microsoft.com': 'microsoft', password: 'password',
};

/**
 * Which way in the person used for this session, for the "Signed in with …" line. Firebase's ID token says it
 * (`signInProvider`), so a restored session names the way actually used, not the first of several linked ones.
 * Only when the token says nothing usable (custom tokens, an old session) does it fall back to the linked ways, in a
 * fixed order.
 */
export function sessionProvider(signInProvider: string | null | undefined, linked: readonly string[]): SignInProvider {
  const used = signInProvider ? FIREBASE_PROVIDERS[signInProvider] : undefined;
  if (used) return used;
  for (const id of ['google.com', 'apple.com', 'microsoft.com', 'password']) if (linked.includes(id)) return FIREBASE_PROVIDERS[id];
  return 'google';
}
