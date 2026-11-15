/** When the splash is shown, kept apart from the page so it can be tested without one. */
export interface SplashContext {
  /** True when something other than a person is driving the browser (automated tests, scripts). */
  automated: boolean;
  alreadyShown: boolean;
  /** `?splash` in the address always shows it, for trying it out. */
  forced: boolean;
}

/** Once per session, on launch. Automated runs skip it so they never wait for an animation. */
export function shouldShowSplash({ automated, alreadyShown, forced }: SplashContext): boolean {
  if (forced) return true;
  return !automated && !alreadyShown;
}

/** How long the finished logo stays before it fades. */
export const HOLD_MS = 350;
export const FADE_MS = 300;
/** With reduced motion there is no animation, so the still logo only stays briefly. */
export const STILL_MS = 700;
