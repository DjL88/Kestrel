// Measures the Vision guardian on a labelled, licensed set. See docs/QUALITY-BENCHMARKS.md.
//   npx tsx scripts/quality/guardian-benchmark.mts prepare labels.json > cases.json   (cases.json beside labels.json)
//   cargo run --release --manifest-path crates/kestrel-vision/Cargo.toml --example guardian_eval -- <model dir> cases.json > answers.jsonl
//   npx tsx scripts/quality/guardian-benchmark.mts score cases.json answers.jsonl
// Read-only: photos are never opened here, and nothing leaves the computer.
import { readFileSync } from 'node:fs';
import { describeGuardianReport, prepareGuardianCases, scoreGuardian, type GuardianAnswer, type GuardianCase, type GuardianLabel } from '../../src/core/guardianBenchmark.ts';

const [command, first, second] = process.argv.slice(2);
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

if (command === 'prepare' && first) {
  const labels = json(first) as GuardianLabel[];
  if (!Array.isArray(labels)) throw new Error('labels.json must be a list of labelled photos');
  process.stdout.write(JSON.stringify(prepareGuardianCases(labels), null, 1) + '\n');
} else if (command === 'score' && first && second) {
  const cases = json(first) as GuardianCase[];
  const lines = readFileSync(second, 'utf8').split('\n').filter((line) => line.trim());
  const answers = lines.map((line) => JSON.parse(line)).filter((row) => typeof row.id === 'string') as GuardianAnswer[];
  const header = lines.length ? JSON.parse(lines[0]) : {};
  const report = scoreGuardian(cases, answers);
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ model: header.model ?? null, loadMs: header.loadMs ?? null, ...report }, null, 1) + '\n');
  else process.stdout.write(`Model ${header.model ?? 'unknown'}, loaded in ${header.loadMs ?? '?'} ms.\n${describeGuardianReport(report)}\n`);
} else {
  process.stderr.write('Usage: guardian-benchmark.mts prepare labels.json | score cases.json answers.jsonl [--json]\n');
  process.exit(2);
}
