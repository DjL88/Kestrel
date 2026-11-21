import { describe, expect, it } from 'vitest';
import { planCuratedAssets, type CuratorCandidate } from './assetCuration';
const candidate: CuratorCandidate = {
  id: 'lens-notes', version: '1.0.0', kind: 'knowledge', sha256: 'a'.repeat(64), bytes: 120,
  licence: 'CC0-1.0', attributionUrl: 'https://example.org/licence', provenance: 'Original Kestrel-authored text',
  rightsReviewer: 'rights-owner', qualityReviewer: 'independent-reviewer',
  rightsApprovedAt: '2026-11-21T00:00:00Z', qualityApprovedAt: '2026-11-21T01:00:00Z',
  evidenceSha256: 'b'.repeat(64),
};
describe('curated data only', () => {
  it('requires approved independent rights and quality review', () => {
    expect(planCuratedAssets([candidate], 200).approved).toHaveLength(1);
    expect(planCuratedAssets([{ ...candidate, qualityReviewer: 'rights-owner' }], 200).quarantined).toHaveLength(1);
  });
  it('quarantines executable packages and missing rights evidence', () => {
    const result = planCuratedAssets([{ ...candidate, executable: true }, { ...candidate, id: 'bad', evidenceSha256: undefined }], 200);
    expect(result.approved).toHaveLength(0);
    expect(result.quarantined).toHaveLength(2);
  });
  it('caps bytes and duplicate ids', () => {
    expect(planCuratedAssets([candidate], 100).approved).toHaveLength(0);
    expect(planCuratedAssets([candidate, candidate], 1000).quarantined).toHaveLength(1);
  });
});
