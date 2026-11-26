import { backupFolder } from './autoBackup';
import { addTags, cleanTag } from './subjectTags';
import { SYNC_ROOT } from './storageConnectors';
import type { CullDecision, PhotoFrame } from './types';

/**
 * Suggestions an AI assistant left through InFlight's MCP tool (`tools/mcp`): decisions, ratings and tags for photos in
 * one project, each with a reason. They sit in the project's own folder beside its backups, are shown to the person,
 * and change nothing until the person presses Apply. Photos are matched by their stable key; unknown ones are dropped.
 */
export interface ProposalItem { photo: string; decision?: CullDecision; rating?: number; addTags?: string[]; reason: string }
export interface AssistantProposal { name: string; createdAt: string; items: ProposalItem[] }

const IDENTITY = /^[a-f0-9]{64}$/;
const FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
const DECISIONS: readonly CullDecision[] = ['keep', 'reject', 'unreviewed'];
export const MAX_PROPOSAL_ITEMS = 200;

/** The folder name an assistant knows a project by: the same hash its backups use, never the title or a path. */
export function projectIdentity(projectId: string): string {
  return backupFolder(projectId).split('/').pop()!;
}

export function proposalFolder(identity: string): string {
  if (!IDENTITY.test(identity)) throw new Error('Unsafe project identity.');
  return `${SYNC_ROOT}/proposals/${identity}`;
}

export function proposalFileName(now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

export const isProposalFile = (folder: string, path: string) => path.startsWith(`${folder}/`) && FILE.test(path.slice(folder.length + 1));

/** Every rule the MCP tool checks when writing, checked again when reading: the file may have been edited by hand. */
export function proposalItemProblem(item: ProposalItem): string | null {
  if (typeof item.photo !== 'string' || !item.photo) return 'A suggestion names no photo.';
  if (item.decision === undefined && item.rating === undefined && !item.addTags?.length) return 'Each suggestion needs a decision, a rating or tags.';
  if (item.decision !== undefined && !DECISIONS.includes(item.decision)) return 'A decision is keep, reject or unreviewed.';
  if (item.rating !== undefined && (!Number.isInteger(item.rating) || item.rating < 0 || item.rating > 5)) return 'A rating is a whole number from 0 to 5.';
  if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 300) return 'Each suggestion needs a short reason (up to 300 characters).';
  if (item.addTags !== undefined && (!Array.isArray(item.addTags) || item.addTags.length > 20 || item.addTags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) return 'Tags must be short, and no more than 20 per photo.';
  return null;
}

/** Read one proposal file. Null for anything malformed; a bad item makes the whole file unusable rather than half-read. */
export function parseProposal(name: string, text: string): AssistantProposal | null {
  if (text.length > 1_000_000) return null;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.format !== 'kestrel-proposal' || record.version !== 1 || typeof record.createdAt !== 'string' || !Array.isArray(record.items)) return null;
  if (!record.items.length || record.items.length > MAX_PROPOSAL_ITEMS) return null;
  const items: ProposalItem[] = [];
  for (const raw of record.items) {
    if (!raw || typeof raw !== 'object') return null;
    const { photo, decision, rating, addTags: tags, reason } = raw as Record<string, unknown>;
    const item = { photo, decision, rating, addTags: tags, reason } as ProposalItem;
    if (proposalItemProblem(item)) return null;
    items.push({
      photo: item.photo, reason: item.reason.trim(),
      ...(item.decision !== undefined ? { decision: item.decision } : {}),
      ...(item.rating !== undefined ? { rating: item.rating } : {}),
      ...(item.addTags?.length ? { addTags: item.addTags.map((tag) => cleanTag(tag)).filter(Boolean) } : {}),
    });
  }
  return { name, createdAt: record.createdAt, items };
}

/** The suggestions that still apply to photos in this project (by stable key, not removed), each with its frame. */
export function matchProposal(frames: readonly PhotoFrame[], proposal: AssistantProposal): Array<ProposalItem & { frameId: string; filename: string }> {
  const byKey = new Map(frames.filter((frame) => frame.removedAt == null && !frame.virtualCopy).map((frame) => [frame.stableKey, frame]));
  return proposal.items.flatMap((item) => {
    const frame = byKey.get(item.photo);
    return frame ? [{ ...item, frameId: frame.id, filename: frame.filename }] : [];
  });
}

/** Ratings and tags from a proposal, applied to the frames it names. Decisions go through the cull history separately. */
export function withProposalMarks(frames: PhotoFrame[], items: ReadonlyArray<ProposalItem & { frameId: string }>): PhotoFrame[] {
  const byId = new Map(items.map((item) => [item.frameId, item]));
  return frames.map((frame) => {
    const item = byId.get(frame.id);
    if (!item || (item.rating === undefined && !item.addTags?.length)) return frame;
    return {
      ...frame,
      ...(item.rating !== undefined ? { rating: item.rating } : {}),
      ...(item.addTags?.length ? { tags: addTags(frame.tags ?? [], item.addTags) } : {}),
    };
  });
}
