/** Offline curator preflight. Produces a dry-run plan; NEVER publishes or signs. */
import type { ApprovedAsset, AssetKind } from './verifiedAssetActivation';
export interface CuratorCandidate {
  id: string; version: string; kind: AssetKind; sha256: string; bytes: number;
  licence: string; attributionUrl: string; provenance: string;
  rightsReviewer?: string; qualityReviewer?: string;
  rightsApprovedAt?: string; qualityApprovedAt?: string;
  evidenceSha256?: string; executable?: boolean;
}
export interface CuratorPlan { approved: ApprovedAsset[]; quarantined: { id: string; reasons: string[] }[]; totalBytes: number }
const ID = /^[a-z][a-z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const KINDS = new Set<AssetKind>(['model', 'lens-db', 'knowledge', 'labels', 'camera-record']);
/**
 * Requires two distinct human approvals, traceable source/rights and evidence.
 * Native/WASM code, unsigned upstream changes and unreviewed model weights
 * are not eligible for the data feed. Signing and upload are separate gates.
 */
export function planCuratedAssets(candidates: readonly CuratorCandidate[], maxBytes: number): CuratorPlan {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || candidates.length > 256)
    throw new Error('Invalid curator budget or candidate count');
  const approved: ApprovedAsset[] = [], quarantined: CuratorPlan['quarantined'] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const c of candidates) {
    const reasons: string[] = [];
    if (!ID.test(c.id) || seen.has(c.id)) reasons.push('unsafe or duplicate id');
    seen.add(c.id);
    if (!VERSION.test(c.version) || !KINDS.has(c.kind) || c.executable)
      reasons.push('unsupported kind/version or executable update');
    if (!SHA.test(c.sha256) || !Number.isSafeInteger(c.bytes) || c.bytes <= 0 ||
        c.bytes > 2_147_483_648) reasons.push('invalid size or digest');
    if (!c.licence.trim() || !c.provenance.trim() ||
        !/^https:\/\//.test(c.attributionUrl) || !SHA.test(c.evidenceSha256 ?? ''))
      reasons.push('licence, provenance, attribution or fixture evidence missing');
    if (!c.rightsReviewer || !c.qualityReviewer || c.rightsReviewer === c.qualityReviewer ||
        !Number.isFinite(Date.parse(c.rightsApprovedAt ?? '')) ||
        !Number.isFinite(Date.parse(c.qualityApprovedAt ?? '')))
      reasons.push('independent rights and quality approvals missing');
    if (reasons.length === 0 && totalBytes + c.bytes > maxBytes)
      reasons.push('curation budget exceeded');
    if (reasons.length) { quarantined.push({ id: c.id, reasons }); continue; }
    totalBytes += c.bytes;
    approved.push({ id: c.id, version: c.version, kind: c.kind, sha256: c.sha256,
      bytes: c.bytes, licence: c.licence, provenance: c.provenance, approved: true });
  }
  return { approved, quarantined, totalBytes };
}
