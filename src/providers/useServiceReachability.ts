import { useEffect, useState } from 'react';
import { currentReachability, HEALTH_STALE_MS, probeControlPlane, type Reachability } from '../core/serviceReachability';
import { useConnectivity } from './useConnectivity';

/** Explicitly initiated session check; after that, recheck on reconnect/focus and at a bounded interval. */
export function useServiceReachability(base?: string) {
  const link = useConnectivity();
  const [requested, setRequested] = useState(false);
  const [revision, setRevision] = useState(0);
  const [observation, setObservation] = useState<{ state: Reachability; at: number | null }>({ state: 'unchecked', at: null });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setObservation({ state: 'unchecked', at: null });
    if (!base || !requested || link === 'offline') return;
    let live = true;
    let running = false;
    let controller: AbortController | undefined;
    const check = async () => {
      if (!live || running || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      running = true;
      controller = new AbortController();
      setObservation({ state: 'checking', at: null });
      const state = await probeControlPlane(base, controller.signal);
      if (live) {
        const at = Date.now();
        setObservation({ state, at });
        setNow(at);
      }
      running = false;
    };
    const refresh = () => { setNow(Date.now()); void check(); };
    void check();
    const interval = window.setInterval(refresh, 60_000);
    const stale = window.setInterval(() => setNow(Date.now()), HEALTH_STALE_MS / 4);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false;
      controller?.abort();
      window.clearInterval(interval);
      window.clearInterval(stale);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [base, link, requested, revision]);
  return {
    state: link === 'offline' ? 'unchecked' as const : currentReachability(observation.state, observation.at, now),
    check: () => { setRequested(true); setRevision(n => n + 1); },
  };
}
