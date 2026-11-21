// The model's own reading, before the app discards it: how often does its description name the right kind of subject?
import { readFileSync } from 'node:fs';
import { factsFromDescription } from '../../src/core/photoCheck.ts';
const { results } = JSON.parse(readFileSync('/home/user/kestrel-models/eval/birds/out/results.json', 'utf8')) as { results: Array<{ name: string; truthKind: string; truthLabel: string; description: string }> };
const AIRCRAFT = /\b(?:helicopters?|aircraft|airplanes?|aeroplanes?|planes?|jets?|choppers?|rotorcraft)\b/i;
const groups: Record<string, { n: number; bird: number; aircraft: number; other: number; none: number }> = {};
const examples: Record<string, string[]> = {};
for (const r of results) {
  const f = factsFromDescription(r.description);
  const said = AIRCRAFT.test(r.description) ? 'aircraft' : f.subject === 'bird' ? 'bird' : f.subject ? 'other' : 'none';
  const g = (groups[r.truthKind] ??= { n: 0, bird: 0, aircraft: 0, other: 0, none: 0 });
  g.n++; g[said as 'bird']++;
  if ((r.truthKind === 'aircraft' && said === 'bird') || (r.truthKind === 'bird' && said !== 'bird')) (examples[r.truthKind] ??= []).push(`${r.truthLabel}: said ${said}: ${r.description.slice(0, 110)}`);
}
for (const [k, g] of Object.entries(groups)) console.log(`${k.padEnd(9)} n=${String(g.n).padStart(3)}  says bird ${g.bird}  says aircraft ${g.aircraft}  other subject ${g.other}  nothing ${g.none}`);
for (const [k, list] of Object.entries(examples)) { console.log(`\n${k}: misreads (${list.length})`); list.slice(0, 8).forEach((l) => console.log('  ', l)); }
