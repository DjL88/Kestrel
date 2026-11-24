import { photographyKnowledge } from './photographyKnowledge';
type Rule = { id: string; guidance: string };
export type PublishedPhotographyPack = { schemaVersion: 1; version: string; rules: Rule[] };
/** Only advisory text may be remotely updated; compiled preservation gates stay authoritative. */
export async function validatePhotographyPack(payload: Uint8Array, signature: Uint8Array, verify: (payload: Uint8Array, signature: Uint8Array) => Promise<boolean>): Promise<PublishedPhotographyPack | null> {
  if (!payload.length || payload.length > 262144 || !signature.length || signature.length > 1024) return null;
  try {
    const bytes = Uint8Array.from(payload);
    if (!await verify(Uint8Array.from(bytes), Uint8Array.from(signature))) return null;
    const raw = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    if (!raw || raw.schemaVersion !== 1 || typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version) || !Array.isArray(raw.rules) || raw.rules.length !== photographyKnowledge.rules.length) return null;
    const allowed = new Set<string>(photographyKnowledge.rules.map(r => r.id));
    const rules: Rule[] = [];
    for (const rule of raw.rules) {
      if (!rule || !allowed.delete(rule.id) || typeof rule.guidance !== 'string' || !rule.guidance.trim() || rule.guidance.length > 500) return null;
      rules.push({id:rule.id,guidance:rule.guidance});
    }
    if (allowed.size) return null;
    return {schemaVersion:1,version:raw.version,rules};
  } catch { return null; }
}
