// Applies the app's own scene-fact rules (src/core/photoCheck.ts) to the saved descriptions and pixels.
import { readFileSync } from 'node:fs';
import { factsFromDescription, supportedSceneFacts } from '../../src/core/photoCheck.ts';

const dir = '/home/user/kestrel-models/eval/birds/out';
const { results } = JSON.parse(readFileSync(`${dir}/results.json`, 'utf8')) as { results: Array<{ name: string; truthKind: string; truthLabel: string; description: string }> };
const tally: Record<string, { n: number; correct: number; abstained: number; wrong: number }> = {};
const wrong: string[] = [], abstained: string[] = [];
for (const r of results) {
  const bytes = readFileSync(`${dir}/${r.name}.rgba`);
  const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const facts = supportedSceneFacts(factsFromDescription(r.description), rgba);
  const t = (tally[r.truthKind] ??= { n: 0, correct: 0, abstained: 0, wrong: 0 });
  t.n++;
  if (!facts.subject) { t.abstained++; if (r.truthKind === 'bird') abstained.push(`${r.truthLabel}: ${r.description}`); }
  else if (facts.subject === r.truthKind) t.correct++;
  else { t.wrong++; wrong.push(`${r.name} truth=${r.truthKind}/${r.truthLabel} app=${facts.subject}: ${r.description}`); }
}
for (const [kind, t] of Object.entries(tally)) console.log(`${kind.padEnd(7)} n=${String(t.n).padStart(3)}  correct ${t.correct}  abstained ${t.abstained}  wrong ${t.wrong}`);
console.log('\nbirds the app abstained on (first 6):'); abstained.slice(0, 6).forEach((l) => console.log('  ', l.slice(0, 150)));
console.log('\nwrong subject (all):'); wrong.forEach((l) => console.log('  ', l.slice(0, 170)));
