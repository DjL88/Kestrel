import type { Server } from 'node:http';
/** Serves site/ on 127.0.0.1. Pass 0 for any free port. */
export function startSiteServer(port?: number): Promise<Server>;
