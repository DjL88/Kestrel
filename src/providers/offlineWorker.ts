/**
 * The desktop shell already bundles its assets. Its embedded browser must not
 * keep serving a previous installer’s offline web cache.
 * Never clear Cache Storage or localStorage here: those may hold user data.
 */
export function isKestrelOfflineWorker(scriptUrl: string, pageUrl: string): boolean {
  try {
    const script = new URL(scriptUrl);
    const page = new URL(pageUrl);
    return script.origin === page.origin && script.pathname.endsWith('/offline.js');
  } catch {
    return false;
  }
}

export async function manageOfflineWorker(production: boolean, desktop: boolean): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    if (desktop) {
      // Remove only Kestrel's own legacy worker. Do not delete caches or
      // unregister unrelated workers; a restart can then load bundled assets.
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((registration) =>
          [registration.active, registration.waiting, registration.installing].some((worker) =>
            worker && isKestrelOfflineWorker(worker.scriptURL, location.href)))
        .map((registration) => registration.unregister()));
    } else if (production) {
      const worker = new URL(`${import.meta.env.BASE_URL}offline.js`, location.href);
      await navigator.serviceWorker.register(worker);
    }
  } catch {
    // Browser policies and private modes may forbid SW operations. Bundled
    // desktop assets and editing remain usable without a service worker.
  }
}
