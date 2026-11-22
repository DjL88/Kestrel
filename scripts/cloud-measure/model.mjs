#!/usr/bin/env node
/**
 * Break-even and cost model for the optional Cloud Processing Engine (docs/CLOUD-PROCESSING.md).
 * Offline arithmetic only: no network, no Google call. Inputs are the measured local times (last-run.jsonl, from
 * the Rust harness here) plus ASSUMPTIONS passed as flags. Every assumption is printed with the result and none of
 * the prices is verified: confirm them in the owner's Google Cloud pricing page and billing console before relying on them.
 *
 *   node scripts/cloud-measure/model.mjs [last-run.jsonl] [--heavy-local-s 20] [--cloud-compute-s 6]
 *        [--result-mb 60] [--gbp-per-compute-s 0.0004] [--gbp-per-gb-egress 0.09] [--jobs-per-pro-month 200]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LINKS_MBIT_UP = [5, 10, 20, 50, 100, 500]; // home/mobile upload speeds, an assumption set

/** Seconds to upload `bytes` at `mbit` Mbit/s with a protocol overhead factor (default 10%). */
export function uploadSeconds(bytes, mbit, overhead = 1.1) { return (bytes * 8 * overhead) / (mbit * 1e6); }

/** Cloud wall time for one job, seconds: upload + queue/cold start + compute + result download. */
export function cloudSeconds({ bytes, resultBytes, upMbit, downMbit, queueS, computeS }) {
  return uploadSeconds(bytes, upMbit) + queueS + computeS + uploadSeconds(resultBytes, downMbit, 1.1);
}

/** The most local time a job can take before the cloud is faster on wall time. Null when the cloud never wins. */
export function breakEvenLocalSeconds(args) { return cloudSeconds(args); }

/** Cost in GBP of one job: compute seconds plus result egress. Storage for minutes is ignored and said so. */
export function jobCostGbp({ computeS, resultBytes, gbpPerComputeS, gbpPerGbEgress }) {
  return computeS * gbpPerComputeS + (resultBytes / 1e9) * gbpPerGbEgress;
}

export function parseRuns(text) {
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error && r.bytes);
}

function flag(name, dflt) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv.slice(2).find((a) => a.endsWith('.jsonl')) ?? fileURLToPath(new URL('./last-run.jsonl', import.meta.url));
  const runs = parseRuns(readFileSync(file, 'utf8'));
  const A = { heavyLocalS: flag('heavy-local-s', 20), computeS: flag('cloud-compute-s', 6), queueS: flag('queue-s', 3),
    resultMb: flag('result-mb', 60), gbpS: flag('gbp-per-compute-s', 0.0004), gbpGb: flag('gbp-per-gb-egress', 0.09), jobs: flag('jobs-per-pro-month', 200), downMbit: flag('down-mbit', 100) };
  console.log('ASSUMPTIONS (not verified):', JSON.stringify(A));
  console.log('\nMEASURED local develop (M4, this machine) vs upload alone, seconds:');
  console.log(['file', 'MB', 'local rgb16', ...LINKS_MBIT_UP.map((m) => `up@${m}M`)].join('\t'));
  for (const r of runs) console.log([r.file.slice(0, 28), (r.bytes / 1e6).toFixed(0), (r.develop_rgb16_ms / 1000).toFixed(1), ...LINKS_MBIT_UP.map((m) => uploadSeconds(r.bytes, m).toFixed(1))].join('\t'));
  const mean = runs.reduce((s, r) => s + r.bytes, 0) / runs.length;
  console.log(`\nCloud wall time for a heavy job on the mean RAW (${(mean / 1e6).toFixed(0)} MB), seconds, vs assumed local ${A.heavyLocalS}s:`);
  for (const m of LINKS_MBIT_UP) {
    const t = cloudSeconds({ bytes: mean, resultBytes: A.resultMb * 1e6, upMbit: m, downMbit: A.downMbit, queueS: A.queueS, computeS: A.computeS });
    console.log(`  up ${String(m).padStart(3)} Mbit/s: ${t.toFixed(1)} s ${t < A.heavyLocalS ? 'CLOUD FASTER' : 'local faster'}`);
  }
  const c = jobCostGbp({ computeS: A.computeS, resultBytes: A.resultMb * 1e6, gbpPerComputeS: A.gbpS, gbpPerGbEgress: A.gbpGb });
  console.log(`\nCost per job: £${c.toFixed(4)}; per Pro account at ${A.jobs} jobs a month: £${(c * A.jobs).toFixed(2)}.`);
}
