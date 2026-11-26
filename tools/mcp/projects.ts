import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSnapshot, type ProjectSnapshot, type SyncedPhoto } from '../../src/core/projectSnapshot.ts';
import { restoreProjectBackup } from '../../src/core/projectBackup.ts';
import { proposalFileName, proposalItemProblem, MAX_PROPOSAL_ITEMS, type ProposalItem } from '../../src/core/assistantProposals.ts';

/**
 * What an assistant may see of an InFlight project, read from the folder a person chose to share. It reads only the
 * project backups InFlight itself writes there (`kestrel/v1/project-backups/<project>/…kestrel.json`: decisions,
 * ratings, tags, edit settings): never photographs, never the rest of the disk. Anything it wants changed becomes a
 * proposal file beside them (`kestrel/v1/proposals/<project>/`), which InFlight shows in Co-pilot for the person to
 * apply or dismiss; nothing is applied for them.
 */
const IDENTITY = /^[a-f0-9]{64}$/;
const BACKUP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[a-f0-9]{32}\.kestrel\.json$/;
const root = (folder: string) => join(folder, 'kestrel', 'v1');

export class McpInputError extends Error {}

const checkProject = (project: string) => { if (!IDENTITY.test(project)) throw new McpInputError('That is not a project id InFlight uses. Use list_projects.'); return project; };

/** "2026-11-16T09-00-00-000Z_…" back to an ISO time. */
const savedAtOf = (name: string) => name.slice(0, 24).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');

async function load(folder: string, project: string): Promise<ProjectSnapshot> {
  checkProject(project);
  let names: string[];
  try { names = (await readdir(join(root(folder), 'project-backups', project))).filter((name) => BACKUP.test(name)).sort(); }
  catch { throw new McpInputError(`No project “${project}” in this folder. Use list_projects.`); }
  // The newest readable backup; an older one stands in if the newest is damaged.
  for (const name of names.reverse()) {
    try {
      const text = await readFile(join(root(folder), 'project-backups', project, name), 'utf8');
      // Restoring validates every field; the title is the project's own (a restore would add "(restored)").
      const state = restoreProjectBackup(text, project);
      const title = String((JSON.parse(text) as { project: { shoot: { title: string } } }).project.shoot.title);
      return buildSnapshot(title, state.frames, new Date(savedAtOf(name)), project);
    } catch { /* try the one before */ }
  }
  throw new McpInputError(`The saved copy of “${project}” could not be read.`);
}

const counts = (photos: SyncedPhoto[]) => ({
  photos: photos.length,
  keep: photos.filter((p) => p.decision === 'keep').length,
  reject: photos.filter((p) => p.decision === 'reject').length,
  toReview: photos.filter((p) => p.decision === 'unreviewed').length,
  rated: photos.filter((p) => (p.rating ?? 0) > 0).length,
});

export async function listProjects(folder: string) {
  let names: string[] = [];
  try { names = await readdir(join(root(folder), 'project-backups')); } catch { return []; }
  const out = [];
  for (const project of names.filter((name) => IDENTITY.test(name)).sort()) {
    try { const snapshot = await load(folder, project); out.push({ project, title: snapshot.title, savedAt: snapshot.savedAt, ...counts(snapshot.photos) }); } catch { /* skip an unreadable copy */ }
  }
  return out;
}

const brief = (photo: SyncedPhoto) => ({
  photo: photo.key, decision: photo.decision, rating: photo.rating ?? 0, tags: photo.tags ?? [], autoTags: photo.autoTags ?? [],
  subjectKind: photo.subjectKind ?? null, edited: Boolean(photo.edit),
});

export async function getProject(folder: string, project: string) {
  const snapshot = await load(folder, project);
  return { project, title: snapshot.title, savedAt: snapshot.savedAt, ...counts(snapshot.photos) };
}

export interface Filter { decision?: 'keep' | 'reject' | 'unreviewed'; minRating?: number; tag?: string; edited?: boolean; limit?: number; offset?: number }

export async function findPhotos(folder: string, slug: string, filter: Filter = {}) {
  const snapshot = await load(folder, slug);
  const tag = filter.tag?.trim().toLowerCase();
  const matches = snapshot.photos.filter((photo) =>
    (!filter.decision || photo.decision === filter.decision) &&
    (filter.minRating === undefined || (photo.rating ?? 0) >= filter.minRating) &&
    (filter.edited === undefined || Boolean(photo.edit) === filter.edited) &&
    (!tag || [...(photo.tags ?? []), ...(photo.autoTags ?? [])].some((entry) => entry.toLowerCase() === tag)));
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return { total: matches.length, offset, photos: matches.slice(offset, offset + limit).map(brief) };
}

export async function getEdit(folder: string, slug: string, key: string) {
  const photo = (await load(folder, slug)).photos.find((candidate) => candidate.key === key);
  if (!photo) throw new McpInputError('That photo is not in this project.');
  return { ...brief(photo), edit: photo.edit ?? null, framing: photo.framing ?? null };
}

export type { ProposalItem };

/**
 * Saves suggestions for the person to look over. Writes one file in the project's proposals folder and nothing else; the
 * project itself is never changed. Every suggestion must name a photo that exists, and say why.
 */
export async function writeProposal(folder: string, project: string, items: ProposalItem[], now = new Date()) {
  const snapshot = await load(folder, project);
  if (!items.length || items.length > MAX_PROPOSAL_ITEMS) throw new McpInputError(`Suggest between 1 and ${MAX_PROPOSAL_ITEMS} changes at a time.`);
  const known = new Set(snapshot.photos.map((photo) => photo.key));
  for (const item of items) {
    if (!known.has(item.photo)) throw new McpInputError('A suggestion names a photo that is not in this project.');
    const problem = proposalItemProblem(item);
    if (problem) throw new McpInputError(problem);
  }
  const folderPath = join(root(folder), 'proposals', project);
  await mkdir(folderPath, { recursive: true });
  const name = proposalFileName(now);
  await writeFile(join(folderPath, name), JSON.stringify({ format: 'kestrel-proposal', version: 1, source: 'assistant', createdAt: now.toISOString(), project, items }, null, 2));
  return { saved: `kestrel/v1/proposals/${project}/${name}`, suggestions: items.length, next: 'InFlight shows these in Co-pilot when this project is open. Nothing changes until the person applies them.' };
}
