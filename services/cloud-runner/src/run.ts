import { processJob, processRecipeJob } from './process.ts';

/** The two object operations the runner needs. The real bucket is adapted in main.ts; tests use a fake. */
export interface RunnerStore {
  read(name: string): Promise<Uint8Array>;
  write(name: string, bytes: Uint8Array): Promise<void>;
}

/**
 * Contract (docs/BACKEND-OWNER-RUNBOOK.md): read inputs/<id>; write results/<id> on success or an empty failed/<id>
 * on failure; delete nothing else; log no payload or file names. Returns whether it succeeded.
 */
export async function runJob(store: RunnerStore, jobId: string, kind: string, maxInputBytes = 120 * 1024 * 1024, inputKind?: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return false; // never build an object path from an unsafe id
  try {
    const input = await store.read(`inputs/${jobId}`);
    if (input.byteLength > maxInputBytes) throw new Error('Input too large.');
    if (kind === 'recipe') {
      // Recipe jobs must say which picture was sent; the answer repeats it so the device can check it.
      if (inputKind !== 'smart-preview' && inputKind !== 'original') throw new Error('Recipe job without its input kind.');
      await store.write(`results/${jobId}`, processRecipeJob(input, jobId, inputKind));
    } else {
      await store.write(`results/${jobId}`, processJob(input, kind));
    }
    return true;
  } catch {
    await store.write(`failed/${jobId}`, new Uint8Array(0));
    return false;
  }
}
