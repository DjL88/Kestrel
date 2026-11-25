import { parseControlPlaneUrl } from './licenceOnline';
export type Reachability = 'unchecked' | 'checking' | 'reachable' | 'unreachable' | 'unverified';
export const HEALTH_STALE_MS = 120_000;

/** A liveness response proves only that the control plane responded, not that its dependencies work. */
export async function probeControlPlane(base: string, signal: AbortSignal, fetcher: typeof fetch = fetch, timeoutMs = 5_000): Promise<Reachability> {
  const url = parseControlPlaneUrl(base);
  if (!url || signal.aborted) return 'unverified';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const deadline = new Promise<Reachability>(resolve => {
    stop = () => { controller.abort(); resolve('unverified'); };
    signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => { controller.abort(); resolve('unreachable'); }, timeoutMs);
  });
  const request = (async (): Promise<Reachability> => {
    try {
      const response = await fetcher(url + '/health', {
        signal: controller.signal, method: 'GET', credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (response.status >= 500) return 'unreachable';
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return 'unverified';
      const value: unknown = await response.json();
      return value !== null && typeof value === 'object' && 'ok' in value && value.ok === true ? 'reachable' : 'unverified';
    } catch {
      return signal.aborted ? 'unverified' : 'unreachable';
    }
  })();
  try { return await Promise.race([deadline, request]); }
  finally {
    clearTimeout(timer);
    if (stop) signal.removeEventListener('abort', stop);
    controller.abort();
  }
}

export function currentReachability(state: Reachability, checkedAt: number | null, now: number): Reachability {
  if (checkedAt === null || state === 'checking') return state;
  return now < checkedAt || now - checkedAt >= HEALTH_STALE_MS ? 'unchecked' : state;
}
