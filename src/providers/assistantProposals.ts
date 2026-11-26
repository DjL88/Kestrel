import { isProposalFile, parseProposal, projectIdentity, proposalFolder, type AssistantProposal } from '../core/assistantProposals';
import type { StorageConnector } from '../core/storageConnectors';
import type { CullingState } from '../core/types';
import { LOCAL_RECOVERY_TARGET, openSourceRecovery } from './automaticRecovery';
import { openConnection } from './connectionStore';
import { getLocations } from './projectLocations';

/**
 * Where an assistant can leave suggestions for a project: the same folders InFlight backs the project up to that a
 * person can point an MCP tool at (the chosen backup location, and the photo folder). Only InFlight's own proposals
 * folder is read; a proposal file is removed once the person applies or dismisses it.
 */
export interface FoundProposal { proposal: AssistantProposal; path: string; connector: StorageConnector }

async function places(state: CullingState): Promise<StorageConnector[]> {
  const out: StorageConnector[] = [];
  const chosen = getLocations(state.shoot.id).backUpTo;
  if (chosen && chosen !== LOCAL_RECOVERY_TARGET) {
    const opened = await openConnection(chosen).catch(() => null);
    if (opened && !('problem' in opened)) out.push(opened.connector);
  }
  const source = await openSourceRecovery(state).catch(() => null);
  if (source && !('problem' in source)) out.push(source.connector);
  return out;
}

/** Proposals for this project, oldest first. A place that cannot be reached is skipped silently: this is optional. */
export async function findProposals(state: CullingState): Promise<FoundProposal[]> {
  const folder = proposalFolder(projectIdentity(state.shoot.id));
  const found = new Map<string, FoundProposal>();
  for (const connector of await places(state)) {
    const names = await connector.list(folder).catch(() => [] as string[]);
    for (const path of names.filter((name) => isProposalFile(folder, name)).sort()) {
      const file = path.slice(folder.length + 1);
      if (found.has(file)) continue;
      const bytes = await connector.get(path).catch(() => null);
      const proposal = bytes ? parseProposal(file, new TextDecoder().decode(bytes)) : null;
      if (proposal) found.set(file, { proposal, path, connector });
    }
  }
  return [...found.values()].sort((a, b) => a.proposal.name.localeCompare(b.proposal.name));
}

/** Best effort: if the file cannot be removed it is remembered as handled for this session instead. */
export async function forgetProposal(found: FoundProposal): Promise<void> {
  await found.connector.remove(found.path).catch(() => undefined);
}
