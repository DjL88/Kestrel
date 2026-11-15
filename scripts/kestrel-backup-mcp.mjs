#!/usr/bin/env node
/**
 * Kestrel backup MCP: read-only, stdio-only, no dependencies or network.
 *
 * Explicit owner-selected backup path only. NEVER opens original photos,
 * changes files, uses the internet or sends any image pixels. Data returned
 * is limited to camera metadata, culling decisions and edit recipes.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_INPUT_LINE = 256 * 1024;
const MAX_PHOTOS = 100_000;
const backupArg = process.argv[2];
if (!backupArg || process.argv.length !== 3 || backupArg === '--help') {
  process.stderr.write('Usage: node scripts/kestrel-backup-mcp.mjs /absolute/path/to/project.kestrel.json\n');
  process.exit(2);
}
const backupPath = resolve(backupArg);
const unique = (a) => [...new Set(a)];
const allowedDecisions = new Set(['keep', 'reject', 'unreviewed']);
const validObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const safeText = (x, size = 240) => typeof x === 'string' && x.length <= size;

async function readProject() {
  const meta = await stat(backupPath);
  if (!meta.isFile() || meta.size > MAX_BACKUP_BYTES) throw new Error('Selected project backup is not a supported regular file or is too large.');
  const raw = await readFile(backupPath, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the read-only size limit.');
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new Error('Could not read this Kestrel project backup.'); }
  if (!validObject(doc) || doc.format !== 'kestrel-project' || doc.version !== 1 ||
    !validObject(doc.project) || !validObject(doc.project.shoot) ||
    !safeText(doc.project.shoot.title) || !Array.isArray(doc.project.frames) ||
    doc.project.frames.length > MAX_PHOTOS) throw new Error('Unsupported Kestrel project backup.');
  const ids = new Set();
  for (const f of doc.project.frames) {
    if (!validObject(f) || !safeText(f.id) || !f.id ||
      !safeText(f.filename, 512) || !allowedDecisions.has(f.decision) ||
      !validObject(f.exif) || ids.has(f.id) ||
      (f.rating !== undefined && (!Number.isInteger(f.rating) || f.rating < 0 || f.rating > 5))) {
      throw new Error('Kestrel backup contains invalid photo records.');
    }
    ids.add(f.id);
  }
  return doc.project;
}
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const schema = (properties = {}, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const tools = [
  { name: 'get_project_summary', description: 'Counts and title from the explicitly selected Kestrel backup, no pixels or paths.', inputSchema: schema() },
  { name: 'list_photos', description: 'List photo filenames, keep/reject decisions and ratings from the selected backup (100 maximum per call).', inputSchema: schema({
    offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    decision: { type: 'string', enum: ['all', 'keep', 'reject', 'unreviewed'], default: 'all' },
  }) },
  { name: 'get_photo_info', description: 'Read camera, lens, exposure settings, labels and rating for one photo in the selected backup. No GPS, serial number or file path.', inputSchema: schema({ photo_id: { type: 'string' } }, ['photo_id']) },
  { name: 'get_edit_recipe', description: 'Read the reversible edit and crop recipe for one photo. Does not modify anything.', inputSchema: schema({ photo_id: { type: 'string' } }, ['photo_id']) },
];
function safeCamera(exif) {
  const out = {};
  for (const key of ['camera', 'lens', 'focalLengthMm', 'apertureF', 'shutterSpeed', 'iso', 'width', 'height', 'formatLabel', 'isEmbeddedPreviewOnly']) {
    const value = exif[key];
    if (typeof value === 'string' && value.length <= 512 || typeof value === 'boolean' ||
      typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
function photoShort(f) {
  return { id: f.id, filename: f.filename, decision: f.decision, rating: f.rating ?? 0,
    tags: Array.isArray(f.tags) ? f.tags.filter((v) => safeText(v, 160)).slice(0, 24) : [] };
}
function validArgs(args, fields) {
  return validObject(args) && Object.keys(args).every((key) => fields.includes(key));
}
async function invoke(name, args) {
  if (!validArgs(args, name === 'list_photos' ? ['offset', 'limit', 'decision'] :
    ['get_photo_info', 'get_edit_recipe'].includes(name) ? ['photo_id'] : [])) return fail('Invalid arguments.');
  const p = await readProject();
  const frames = p.frames;
  if (name === 'get_project_summary') {
    return ok({ title: p.shoot.title, total: frames.length, keep: frames.filter((f) => f.decision === 'keep').length,
      reject: frames.filter((f) => f.decision === 'reject').length,
      unreviewed: frames.filter((f) => f.decision === 'unreviewed').length });
  }
  if (name === 'list_photos') {
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 25;
    const decision = args.decision ?? 'all';
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !['all', ...allowedDecisions].includes(decision)) return fail('Use an offset >= 0, limit 1–100 and a valid decision.');
    const selection = decision === 'all' ? frames : frames.filter((f) => f.decision === decision);
    return ok({ count: selection.length, offset, photos: selection.slice(offset, offset + limit).map(photoShort) });
  }
  if (name === 'get_photo_info' || name === 'get_edit_recipe') {
    if (!safeText(args.photo_id, 240) || !args.photo_id) return fail('Choose a photo_id returned by list_photos.');
    const f = frames.find((item) => item.id === args.photo_id);
    if (!f) return fail('Photo not found in the chosen backup.');
    if (name === 'get_photo_info') {
      return ok({ ...photoShort(f), exif: safeCamera(f.exif),
        subjectKind: safeText(f.subjectKind) ? f.subjectKind : undefined });
    }
    // The backup contains only serialised edit instructions, not image pixels.
    // Return no history to avoid huge responses, and never disclose file paths.
    return ok({ id: f.id, edit: f.edit ?? null, framing: f.framing ?? null,
      focusPoint: f.focusPoint ?? null, historySteps: f.editHistory?.steps?.length ?? 0 });
  }
  return fail('Unknown tool.');
}
function send(response) { process.stdout.write(JSON.stringify(response) + '\n'); }
async function handle(req) {
  if (!validObject(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return;
  if (!Object.hasOwn(req, 'id')) return; // notification
  const id = req.id;
  const base = { jsonrpc: '2.0', id };
  if (req.method === 'initialize') {
    return send({ ...base, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'kestrel-backup-readonly', version: '0.1.0' } } });
  }
  if (req.method === 'ping') return send({ ...base, result: {} });
  if (req.method === 'tools/list') return send({ ...base, result: { tools } });
  if (req.method === 'tools/call') {
    try {
      const name = req.params?.name;
      const toolArgs = req.params?.arguments ?? {};
      if (!tools.some((tool) => tool.name === name)) return send({ ...base, result: fail('Unknown tool.') });
      return send({ ...base, result: await invoke(name, toolArgs) });
    } catch (error) {
      return send({ ...base, result: fail(error instanceof Error ? error.message : 'Unable to read backup.') });
    }
  }
  return send({ ...base, error: { code: -32601, message: 'Method not found' } });
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
reader.on('line', (line) => {
  if (line.length > MAX_INPUT_LINE) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
    return;
  }
  try { void handle(JSON.parse(line)); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
});
