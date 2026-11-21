/** Local model suggestions are untrusted evidence, never executable edit commands.
 * This boundary accepts only bounded, reversible ordinary editing parameters.
 * It has no network, file-writing, photo-upload or model-download capability.
 */
import { createOfflineInferenceGate, type InferenceRequest, type InferenceResult } from './offlineInferenceGate';
import type { OfflineAssetRuntime } from './offlineAssetRuntime';

export type LocalEdit = Readonly<
  | { kind: 'exposure'; stops: number }
  | { kind: 'contrast'; amount: number }
  | { kind: 'saturation'; amount: number }
  | { kind: 'temperature'; kelvinShift: number }
  | { kind: 'crop'; x: number; y: number; width: number; height: number }
>;
export interface LocalRecipe {
  title: string;
  explanation: string;
  edits: readonly LocalEdit[];
  /** Never interpreted as colour truth or species certainty. */
  confidence: number;
}
export interface RecipeProposal {
  recipes: readonly LocalRecipe[];
  provenance: { modelId: string; assetSha256: string; sourceHash: string; recipeRevision: number };
}
export interface TrustedRecipeContext {
  sourceHash: string;
  recipeRevision: number;
  modelId: string;
  /** Obtained from the signed cache authority, not model-generated text. */
  assetSha256: string;
}
const sha = /^[a-f0-9]{64}$/;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const range = (n: unknown, low: number, high: number): n is number =>
  finite(n) && n >= low && n <= high;
const plain = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= max &&
  !/[<>\u0000-\u001f]/.test(s);
function validEdit(edit: LocalEdit): boolean {
  if (!edit || typeof edit !== 'object') return false;
  switch (edit.kind) {
    case 'exposure': return range(edit.stops, -1, 1);
    case 'contrast': return range(edit.amount, -0.25, 0.25);
    case 'saturation': return range(edit.amount, -0.2, 0.2);
    case 'temperature': return range(edit.kelvinShift, -600, 600);
    case 'crop': return range(edit.x, 0, 1) && range(edit.y, 0, 1) &&
      range(edit.width, 0.2, 1) && range(edit.height, 0.2, 1) &&
      edit.x + edit.width <= 1.000001 && edit.y + edit.height <= 1.000001;
    default: return false;
  }
}
/** Fail closed on hallucinated operations, unknown fields and stale source receipts. */
export function validateLocalRecipes(value: unknown, expected: TrustedRecipeContext): RecipeProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid recipe proposal');
  const proposal = value as RecipeProposal;
  if (!sha.test(expected.sourceHash) || !sha.test(expected.assetSha256) ||
      !Number.isSafeInteger(expected.recipeRevision) || expected.recipeRevision < 0 ||
      !plain(expected.modelId, 128) ||
      !proposal.provenance || proposal.provenance.sourceHash !== expected.sourceHash ||
      proposal.provenance.assetSha256 !== expected.assetSha256 ||
      proposal.provenance.modelId !== expected.modelId ||
      proposal.provenance.recipeRevision !== expected.recipeRevision ||
      !Array.isArray(proposal.recipes) || proposal.recipes.length !== 3)
    throw Error('Missing or stale local model provenance');
  for (const recipe of proposal.recipes) {
    if (!recipe || !plain(recipe.title, 70) || !plain(recipe.explanation, 300) ||
        !range(recipe.confidence, 0, 1) || !Array.isArray(recipe.edits) ||
        recipe.edits.length < 1 || recipe.edits.length > 5 ||
        !recipe.edits.every(validEdit))
      throw Error('Unsafe or unsupported model edit proposal');
  }
  // Clone: never expose model-owned mutable buffers or objects to the editor.
  return structuredClone(proposal);
}
/** The local gate supplies bounded resource scheduling and offline fallback.
 * Model output must pass validation; otherwise use classical recipes.
 * The editor must still ask approval (Glide/Fly Solo), or apply only under
 * explicit Soar opt-in with undo/history and confidence policy.
 */
export function createLocalRecipeAdvisor(runtime: Pick<OfflineAssetRuntime<unknown>, 'open'>) {
  const gate = createOfflineInferenceGate(runtime);
  return {
    async suggest(
      request: Omit<InferenceRequest<unknown>, 'classical'>,
      expected: TrustedRecipeContext,
      classical: () => RecipeProposal,
    ): Promise<InferenceResult<RecipeProposal>> {
      const safeClassical = () => validateLocalRecipes(classical(), expected);
      // Fly Solo must not run any analysis, including classical, unless requested.
      if (request.mode === 'fly-solo' && !request.explicitlyRequested)
        return { source: 'classical', value: { recipes: [], provenance: { ...expected } }, reason: 'permission' };
      const result = await gate.propose({ ...request, classical: safeClassical });
      if (result.source === 'classical') return result as InferenceResult<RecipeProposal>;
      try {
        return { ...result, value: validateLocalRecipes(result.value, expected) };
      } catch {
        return { source: 'classical', value: safeClassical(), reason: 'model-error' };
      }
    },
  };
}
