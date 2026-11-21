import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSnapshot, type ProjectSnapshot, type SyncedPhoto } from '../../src/core/projectSnapshot.ts';

/**
 * What an assistant may see of a Kite44 project, read from the sync folder a person chose to share. It reads only the
 * small project files Kite44 writes there (decisions, ratings, tags, edit settings): never photographs, never the
 * rest of the disk. Anything it wants changed becomes a proposal file the person reviews; nothing is applied for them.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const root = (folder: string) => join(folder, 'kestrel', 'v1');

export class McpInputError extends Error {}

const checkSlug = (slug: string) => { if (!SLUG.test(slug)) throw new McpInputError('That is not a project name Kite44 uses.'); return slug; };

async function load(folder: string, slug: string): Promise<ProjectSnapshot> {
  checkSlug(slug);
  let text: string;
  try { text = await readFile(join(root(folder), 'recipes', slug, 'project.json'), 'utf8'); }
  catch { throw new McpInputError(`No project called “${slug}” in the sync folder. Use list_projects.`); }
  const snapshot = parseSnapshot(text);
  if (!snapshot) throw new McpInputError(`The saved copy of “${slug}” could not be read.`);
  return snapshot;
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
  try { names = await readdir(join(root(folder), 'recipes')); } catch { return []; }
  const out = [];
  for (const slug of names.filter((name) => SLUG.test(name)).sort()) {
    try { const snapshot = await load(folder, slug); out.push({ project: slug, title: snapshot.title, savedAt: snapshot.savedAt, ...counts(snapshot.photos) }); } catch { /* skip an unreadable copy */ }
  }
  return out;
}

const brief = (photo: SyncedPhoto) => ({
  photo: photo.key, decision: photo.decision, rating: photo.rating ?? 0, tags: photo.tags ?? [], autoTags: photo.autoTags ?? [],
  subjectKind: photo.subjectKind ?? null, edited: Boolean(photo.edit),
});

export async function getProject(folder: string, slug: string) {
  const snapshot = await load(folder, slug);
  return { project: slug, title: snapshot.title, savedAt: snapshot.savedAt, ...counts(snapshot.photos) };
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

export interface ProposalItem { photo: string; decision?: 'keep' | 'reject' | 'unreviewed'; rating?: number; addTags?: string[]; reason: string }

/**
 * Saves suggestions for the person to look over. Writes one file in a proposals folder and nothing else; the project
 * itself is never changed. Every suggestion must name a photo that exists, and say why.
 */
export async function writeProposal(folder: string, slug: string, items: ProposalItem[], now = new Date()) {
  const snapshot = await load(folder, slug);
  if (!items.length || items.length > 200) throw new McpInputError('Suggest between 1 and 200 changes at a time.');
  const known = new Set(snapshot.photos.map((photo) => photo.key));
  for (const item of items) {
    if (!known.has(item.photo)) throw new McpInputError('A suggestion names a photo that is not in this project.');
    if (item.decision === undefined && item.rating === undefined && !item.addTags?.length) throw new McpInputError('Each suggestion needs a decision, a rating or tags.');
    if (item.rating !== undefined && (!Number.isInteger(item.rating) || item.rating < 0 || item.rating > 5)) throw new McpInputError('A rating is a whole number from 0 to 5.');
    if (!item.reason?.trim() || item.reason.length > 300) throw new McpInputError('Each suggestion needs a short reason (up to 300 characters).');
    if ((item.addTags?.length ?? 0) > 20 || item.addTags?.some((tag) => !tag.trim() || tag.length > 80)) throw new McpInputError('Tags must be short, and no more than 20 per photo.');
  }
  const folderPath = join(root(folder), 'proposals', slug);
  await mkdir(folderPath, { recursive: true });
  const name = `${now.toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(join(folderPath, name), JSON.stringify({ format: 'kestrel-proposal', version: 1, source: 'assistant', createdAt: now.toISOString(), project: slug, items }, null, 2));
  return { saved: `kestrel/v1/proposals/${slug}/${name}`, suggestions: items.length };
}
