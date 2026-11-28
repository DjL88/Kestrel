import { EMBED_MODEL } from './visualSimilarity';
import type { SpeciesGuess } from './speciesPalette';

/**
 * InFlight's own species head: a tiny linear classifier (a few KB) on top of the frozen DINOv2 ViT-S/14 embedding the
 * app already makes for burst grouping (Apache-2.0, Meta; see docs/notices/dinov2.txt). Trained only on the owner's own
 * photos (scripts/species_own), so it names only the species that were in them and says nothing otherwise.
 *
 * Honest limits, enforced here and not only in the docs:
 *  - It abstains (returns null) when its top share is below `minConfidence` or the picture is not close to any trained
 *    species (`minSimilarity`): unknown stays unknown. It never names a photo on its own authority: callers treat the
 *    result as a suggestion, exactly like the other species path.
 *  - A head whose labels were not confirmed by the owner (`trainedOn.labelsConfirmed` false) is a research preview.
 *  - The head must match the embedding model it was trained on (id and file hash), or it refuses to run.
 */
export interface OwnSpeciesHead {
  schema: 'kestrel-own-species-head/1';
  base: { id: string; licence: string; dims: number; sha256: string };
  kind: 'prototype' | 'linear';
  /** Index of a trained "not in list" class. When it wins, the head abstains. Absent for a head without one. */
  otherIndex?: number;
  labels: { common: string; scientific: string }[];
  /** One row per label, one number per embedding dimension. */
  W: number[][];
  b: number[];
  minConfidence: number;
  minSimilarity: number;
  trainedOn: { frames: number; shoots: number; labelsConfirmed: boolean };
}

export interface OwnSpeciesAnswer {
  guess: SpeciesGuess;
  /** True when the head's training labels were not confirmed by a person: shown as a preview, never auto-applied. */
  provisional: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Check an untrusted head file. Anything unexpected returns null: no head, no suggestion. */
export function parseOwnSpeciesHead(value: unknown, embedding: { id: string; sha256: string; dims: number } = { ...EMBED_MODEL }): OwnSpeciesHead | null {
  const head = value as Partial<OwnSpeciesHead> | null;
  if (!head || head.schema !== 'kestrel-own-species-head/1' || !head.base || !head.trainedOn) return null;
  if (head.base.id !== embedding.id || head.base.sha256 !== embedding.sha256 || head.base.dims !== embedding.dims) return null;
  if (head.kind !== 'prototype' && head.kind !== 'linear') return null;
  const { labels, W, b } = head;
  if (head.otherIndex !== undefined && !(Number.isInteger(head.otherIndex) && head.otherIndex >= 0 && head.otherIndex < (labels?.length ?? 0))) return null;
  if (!Array.isArray(labels) || labels.length < 2 || !Array.isArray(W) || W.length !== labels.length || !Array.isArray(b) || b.length !== labels.length) return null;
  if (labels.some((label) => !label || typeof label.common !== 'string' || !label.common.trim() || typeof label.scientific !== 'string')) return null;
  if (W.some((row) => !Array.isArray(row) || row.length !== embedding.dims || !row.every(finite)) || !b.every(finite)) return null;
  if (!finite(head.minConfidence) || head.minConfidence <= 0 || head.minConfidence > 1) return null;
  if (!finite(head.minSimilarity) || head.minSimilarity < -1 || head.minSimilarity > 1) return null;
  return head as OwnSpeciesHead;
}

/** The answer for one picture embedding, or null when the head should abstain. */
export function classifyOwnSpecies(embedding: Float32Array, head: OwnSpeciesHead): OwnSpeciesAnswer | null {
  if (embedding.length !== head.base.dims || !embedding.every(Number.isFinite)) return null;
  let norm = 0;
  for (const value of embedding) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  const logits: number[] = [];
  let closest = -1;
  head.W.forEach((row, index) => {
    let dot = 0, rowNorm = 0;
    for (let i = 0; i < row.length; i += 1) { dot += row[i] * embedding[i]; rowNorm += row[i] * row[i]; }
    logits.push(dot / norm + head.b[index]);
    if (rowNorm > 0 && index !== head.otherIndex) closest = Math.max(closest, dot / norm / Math.sqrt(rowNorm));
  });
  const top = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - top));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const shares = weights.map((weight) => weight / total);
  const order = shares.map((share, index) => ({ share, index })).sort((a, b) => b.share - a.share || a.index - b.index);
  if (order[0].index === head.otherIndex || order[0].share < head.minConfidence || closest < head.minSimilarity) return null;
  return {
    guess: { common: head.labels[order[0].index].common, probability: order[0].share, runnerUp: order[1]?.share ?? 0 },
    provisional: !head.trainedOn.labelsConfirmed,
  };
}
