import { recordModelLoad, recordModelRun } from '../core/modelStats';
import { createOrtSession } from './ortRuntime';

/**
 * Create an onnxruntime session and measure it: how long it took to load, and how long every run takes from then on
 * (src/core/modelStats.ts, shown in Settings → Models). The session itself is unchanged; only `run` is timed.
 */
type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

export function timeRuns(id: string, session: Session, source: 'use' | 'measure' = 'use'): Session {
  const run = session.run.bind(session) as Session['run'];
  (session as { run: Session['run'] }).run = (async (...args: Parameters<Session['run']>) => {
    const started = performance.now();
    const out = await run(...args);
    recordModelRun(id, performance.now() - started, source);
    return out;
  }) as Session['run'];
  return session;
}

export async function createTimedSession(ort: Ort, id: string, bytes: Uint8Array, options: Parameters<Ort['InferenceSession']['create']>[1],
  source: 'use' | 'measure' = 'use'): Promise<Session> {
  const started = performance.now();
  const session = await createOrtSession(ort, bytes, options);
  recordModelLoad(id, performance.now() - started, source);
  return timeRuns(id, session, source);
}
