#!/usr/bin/env -S npx tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findPhotos, getEdit, getProject, listProjects, McpInputError, writeProposal } from './projects.ts';

/**
 * Kestrel for AI assistants (Model Context Protocol), run on this computer by the assistant app.
 *   npx tsx tools/mcp/kestrel-mcp.ts <sync folder> [--allow-proposals]
 * It reads the project files Kestrel keeps in a sync folder. Read-only by default. With --allow-proposals it may also
 * leave suggestions in a separate proposals folder, which Kestrel shows for the person to accept. It never changes a
 * project, touches photographs, or uses the network.
 */
const args = process.argv.slice(2);
const folder = args.find((arg) => !arg.startsWith('--'));
const allowProposals = args.includes('--allow-proposals');
if (!folder) { console.error('Usage: kestrel-mcp <sync folder> [--allow-proposals]'); process.exit(2); }

const server = new McpServer({ name: 'kestrel', version: '0.1.0' });

const answer = async (work: () => Promise<unknown>) => {
  try { return { content: [{ type: 'text' as const, text: JSON.stringify(await work(), null, 2) }] }; }
  catch (error) {
    const message = error instanceof McpInputError ? error.message : 'Something went wrong reading the Kestrel folder.';
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }
};
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

server.registerTool('list_projects', { description: 'List the Kestrel projects in the sync folder, with how many photos are kept, rejected and still to review.', annotations: readOnly }, () => answer(() => listProjects(folder)));
server.registerTool('get_project', { description: 'Summary of one project: title, when it was saved and the photo counts.', inputSchema: { project: z.string().describe('The project name from list_projects') }, annotations: readOnly }, ({ project }) => answer(() => getProject(folder, project)));
server.registerTool('find_photos', {
  description: 'Find photos in a project by decision, rating, tag or whether they have been edited. Returns file names, decisions, ratings and tags (no pixels).',
  inputSchema: { project: z.string(), decision: z.enum(['keep', 'reject', 'unreviewed']).optional(), minRating: z.number().int().min(0).max(5).optional(), tag: z.string().optional(), edited: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() },
  annotations: readOnly,
}, (input) => answer(() => findPhotos(folder, input.project, input)));
server.registerTool('get_edit', { description: 'The edit settings (sliders, masks, crop) saved for one photo.', inputSchema: { project: z.string(), photo: z.string().describe('The photo identifier from find_photos') }, annotations: readOnly }, ({ project, photo }) => answer(() => getEdit(folder, project, photo)));

if (allowProposals) {
  server.registerTool('propose_changes', {
    description: 'Suggest decisions, ratings or tags for photos. This only saves suggestions for the person to review in Kestrel; nothing is changed. Give a short reason for each.',
    inputSchema: { project: z.string(), changes: z.array(z.object({ photo: z.string(), decision: z.enum(['keep', 'reject', 'unreviewed']).optional(), rating: z.number().int().min(0).max(5).optional(), addTags: z.array(z.string()).optional(), reason: z.string() })).min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ project, changes }) => answer(() => writeProposal(folder, project, changes)));
}

await server.connect(new StdioServerTransport());
