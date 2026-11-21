import { describe, expect, it } from 'vitest';
import { createLocalRecipeAdvisor, validateLocalRecipes, type RecipeProposal } from './localModelRecipeBoundary';

const hash = 'a'.repeat(64);
const assetHash = 'b'.repeat(64);
const expected = { sourceHash: hash, assetSha256: assetHash, recipeRevision: 3, modelId: 'local-bird' };
const recipe = (): RecipeProposal => ({
  provenance: { ...expected },
  recipes: [1, 2, 3].map(i => ({
    title: 'Natural edit ' + i, explanation: 'A reversible adjustment',
    confidence: 0.8, edits: [{ kind: 'exposure' as const, stops: 0.1 }],
  })),
});
describe('local model recipe trust boundary', () => {
  it('accepts three bounded reversible edits for the exact source revision', () => {
    expect(validateLocalRecipes(recipe(), expected).recipes).toHaveLength(3);
  });
  it('refuses stale photo, model and edit revision', () => {
    for (const change of [{ sourceHash: 'c'.repeat(64) }, { recipeRevision: 4 }, { assetSha256: 'd'.repeat(64) }]) {
      expect(() => validateLocalRecipes(recipe(), { ...expected, ...change })).toThrow();
    }
  });
  it('refuses generated content and extreme or invalid edits', () => {
    const bad = recipe();
    (bad.recipes[0].edits as unknown[])[0] = { kind: 'replace-sky', prompt: 'new clouds' };
    expect(() => validateLocalRecipes(bad, expected)).toThrow();
    const extreme = recipe();
    (extreme.recipes[0].edits as unknown[])[0] = { kind: 'exposure', stops: 9 };
    expect(() => validateLocalRecipes(extreme, expected)).toThrow();
  });
  it('refuses crop outside image and markup in explanations', () => {
    const bad = recipe();
    (bad.recipes[0].edits as unknown[])[0] = { kind: 'crop', x: 0.9, y: 0, width: 0.5, height: 1 };
    expect(() => validateLocalRecipes(bad, expected)).toThrow();
    const markup = recipe();
    (markup.recipes[0] as { explanation: string }).explanation = '<script>oops</script>';
    expect(() => validateLocalRecipes(markup, expected)).toThrow();
  });
  it('does not open a model or run classical analysis in unsolicited Fly Solo', async () => {
    let opened = 0; let classical = 0;
    const advisor = createLocalRecipeAdvisor({ open: async () => { opened++; return { source: 'unavailable' as const }; } });
    const result = await advisor.suggest({
      mode: 'fly-solo', explicitlyRequested: false, soarOptIn: false,
      model: { id: 'local-bird', rightsApproved: true, backend: 'cpu', estimatedRamBytes: 1024 },
      device: { availableRamBytes: 8192, maxModelRamBytes: 4096, onBattery: false, allowedBackends: ['cpu'] },
      bundled: async () => undefined, runLocal: async () => recipe(),
    }, expected, () => { classical++; return recipe(); });
    expect(result.value.recipes).toHaveLength(0);
    expect([opened, classical]).toEqual([0, 0]);
  });
  it('falls back to conventional recipes on invalid model output without uploading', async () => {
    const advisor = createLocalRecipeAdvisor({ open: async () => ({ source: 'bundled' as const, bytes: new Uint8Array([1]) }) });
    const result = await advisor.suggest({
      mode: 'glide', explicitlyRequested: true, soarOptIn: false,
      model: { id: 'local-bird', rightsApproved: true, backend: 'cpu', estimatedRamBytes: 1024 },
      device: { availableRamBytes: 8192, maxModelRamBytes: 4096, onBattery: false, allowedBackends: ['cpu'] },
      bundled: async () => undefined, runLocal: async () => ({ ...recipe(), recipes: [{ title: 'bad' }] }),
    }, expected, recipe);
    expect(result.source).toBe('classical');
    expect(result.value.recipes).toHaveLength(3);
  });
});
