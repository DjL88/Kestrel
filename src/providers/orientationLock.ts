import { isDesktopApp } from './desktopShell';

/**
 * On an iPhone the app stays upright, except while a photo is shown full screen, when turning the phone is allowed so a
 * landscape photo can be seen bigger. An iPad and every other device are not limited, so this does nothing there: the
 * native command only acts on an iPhone, and anywhere it does not exist the call is quietly ignored.
 */
export async function setLandscapeAllowed(allowed: boolean): Promise<void> {
  if (!isDesktopApp() || navigator.maxTouchPoints < 1) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_landscape_allowed', { allowed });
  } catch { /* not an iPhone build: nothing to turn */ }
}
