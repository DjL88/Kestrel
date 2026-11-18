import type { CullSuggestion } from './autoCull';
import { signatureSimilarity } from './kestrelVision';
import type { PhotoFrame } from './types';

/**
 * Even when files lack EXIF timestamps or burstGroupId (common in browser JPEG/PNG drops),
 * consecutive near-identical frames of the same scene/subject can be detected via compact
 * perceptual signatures. Within any perceptual burst cluster (similarity >= threshold),
 * only the sharpest/highest-scoring candidate keeps high-confidence automatic Keep;
 * softer siblings are held for review so Kestrel picks the crispest frame automatically.
 */
export function dedupeNearSimilarKeepers(
  results: readonly CullSuggestion[],
  frames: readonly PhotoFrame[],
  signatures: ReadonlyMap<string, Float32Array>,
  similarityThreshold = 0.94,
): CullSuggestion[] {
  if (results.length < 2 || signatures.size < 2) return [...results];
  const byFrameId = new Map(frames.map((f) => [f.id, f]));
  const winners: Array<{ frameId: string; score: number; sig: Float32Array }> = [];

  // Pre-seed with any existing non-removed keepers in the catalogue so a second scan won't double-pick
  for (const frame of frames) {
    if (frame.removedAt == null && frame.decision === 'keep') {
      const sig = signatures.get(frame.id);
      if (sig) winners.push({ frameId: frame.id, score: 100, sig });
    }
  }

  const orderedKeepers = results
    .filter((r) => r.decision === 'keep' && r.confidence === 'high' && signatures.has(r.frameId))
    .sort((a, b) => b.score - a.score || a.frameId.localeCompare(b.frameId));

  const demoted = new Set<string>();
  for (const candidate of orderedKeepers) {
    const frame = byFrameId.get(candidate.frameId);
    // Frames with explicit EXIF burstGroupId are already handled by limitAutoKeepers
    if (!frame || frame.burstGroupId) continue;
    const sig = signatures.get(candidate.frameId)!;
    const similarWinner = winners.find((w) => w.frameId !== candidate.frameId && signatureSimilarity(w.sig, sig) >= similarityThreshold);
    if (similarWinner) {
      demoted.add(candidate.frameId);
    } else {
      winners.push({ frameId: candidate.frameId, score: candidate.score, sig });
    }
  }

  if (!demoted.size) return [...results];
  return results.map((result) =>
    demoted.has(result.frameId)
      ? {
          ...result,
          decision: null,
          confidence: 'medium',
          score: Math.min(78, result.score),
          reason: result.reason === 'subjectSharp' ? 'subjectOk' : result.reason,
        }
      : result,
  );
}
