/**
 * Crash-aware bridge between the app-lifetime Task Manager queue and the export
 * checkpoint journal. No file bytes, paths outside the selected destination,
 * permissions or credentials are persisted by this module.
 *
 * A platform adapter MUST provide atomic no-overwrite publication and a durable,
 * atomic journal storage implementation. Neither browser downloads nor localStorage
 * alone satisfy those contracts. Recovery is explicit; never auto-run on startup.
 */
import { exportBatchQueue, snapshotExportRecipe, type ExportBatchTicket } from './exportBatchQueue';
import {
  createExportQueueJournal,
  type ExportQueueCheckpoint,
  type ExportQueueItem,
  type ExportQueueReceipt,
  type ExportQueueStorage,
} from './exportQueueJournal';

export interface DurableExportPlan<Recipe> {
  id: string;
  title: string;
  items: readonly ExportQueueItem[];
  recipe: Recipe;
}
export interface DurableExportAdapter<Recipe, Output> {
  /** Must read and hash the current original bytes, not just compare a pathname. */
  verifySource(item: ExportQueueItem): Promise<boolean>;
  /** Must hash an existing output before accepting its completion receipt. */
  verifyOutput(item: ExportQueueItem, receipt: ExportQueueReceipt): Promise<boolean>;
  render(item: ExportQueueItem, recipe: Readonly<Recipe>, signal: AbortSignal): Promise<Output>;
  /**
   * Publish using temp-file + fsync + exclusive no-overwrite rename/link as
   * appropriate to the platform. Return the SHA-256 of the committed output.
   * A failed publication must never replace an existing file.
   */
  publishAtomic(item: ExportQueueItem, output: Output, signal: AbortSignal): Promise<string>;
}
export interface DurableExportQueue {
  enqueue<Recipe, Output>(
    plan: { title: string; items: readonly { sourceId: string; filename: string; subfolder: string }[]; recipe: Recipe },
    adapter: {
      render(item: { sourceId: string; filename: string; subfolder: string }, recipe: Readonly<Recipe>, signal: AbortSignal): Promise<Output>;
      save(item: { sourceId: string; filename: string; subfolder: string }, output: Output, signal: AbortSignal): Promise<void>;
    },
  ): ExportBatchTicket;
}
const HASH = /^[a-f0-9]{64}$/i;
type ExportDestination = Pick<ExportQueueItem, 'subfolder' | 'filename'>;
const relative = (item: ExportDestination) => item.subfolder ? item.subfolder + '/' + item.filename : item.filename;
const key = (item: ExportDestination) => relative(item).toLowerCase();
const abortIf = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error('Export cancelled.');
};

export function createJournalledExportDispatch(
  storage: ExportQueueStorage,
  queue: DurableExportQueue = exportBatchQueue,
) {
  const journal = createExportQueueJournal(storage);
  const active = new Set<string>();
  // Includes jobs still verifying source/output receipts before they reach the queue.
  const resuming = new Set<string>();

  function enqueueVerified<Recipe, Output>(
    checkpoint: ExportQueueCheckpoint<Recipe>,
    indexes: readonly number[],
    adapter: DurableExportAdapter<Recipe, Output>,
  ): ExportBatchTicket {
    if (active.has(checkpoint.id)) throw new Error('This export is already running.');
    if (!indexes.length) throw new Error('No exports remain to run.');
    const indexed = new Map<string, number>();
    for (const index of indexes) indexed.set(key(checkpoint.items[index]), index);
    active.add(checkpoint.id);
    let ticket: ExportBatchTicket;
    try {
      ticket = queue.enqueue({
        title: checkpoint.title,
        items: indexes.map(index => checkpoint.items[index]),
        recipe: snapshotExportRecipe(checkpoint.recipe),
      }, {
        render: async (item, recipe, signal) => {
          abortIf(signal);
          const index = indexed.get(key(item));
          if (index === undefined) throw new Error('Export item does not belong to this checkpoint.');
          const source = checkpoint.items[index];
          if (!await adapter.verifySource(source)) throw new Error('Original changed; export stopped.');
          abortIf(signal);
          return adapter.render(source, recipe, signal);
        },
        save: async (item, output, signal) => {
          abortIf(signal);
          const index = indexed.get(key(item));
          if (index === undefined) throw new Error('Export item does not belong to this checkpoint.');
          const source = checkpoint.items[index];
          // Recheck after a long render: a disconnected NAS may have been replaced.
          if (!await adapter.verifySource(source)) throw new Error('Original changed during export.');
          abortIf(signal);
          const outputSha256 = await adapter.publishAtomic(source, output, signal);
          if (!HASH.test(outputSha256)) throw new Error('Export adapter did not return a verified output SHA-256.');
          // If journal persistence fails after publication, the next explicit
          // attempt must fail safely on the adapter's no-overwrite collision.
          journal.receipt<Recipe>(checkpoint.id, {
            index, outputSha256: outputSha256.toLowerCase(), relativePath: relative(source),
          });
        },
      });
    } catch (error) {
      active.delete(checkpoint.id);
      throw error;
    }
    // The task queue finishes rendering before the final durable journal commit.
    // Do not expose success to callers until the checkpoint has been persisted.
    // A failed commit must be reported as failure, not as a completed export.
    const committed = ticket.done.then(result => {
      if (result === 'completed') {
        const saved = journal.load<Recipe>(checkpoint.id);
        if (!saved || saved.receipts.length !== saved.items.length) {
          throw new Error('Export finished without a complete durable receipt journal.');
        }
        journal.save({ ...saved, state: 'completed' });
      } else {
        journal.pause(checkpoint.id);
      }
      return result;
    }).catch((): 'failed' => {
      // Preserve receipts for explicit verified recovery. Never report success
      // after an unsuccessful durable checkpoint write.
      return 'failed';
    }).finally(() => { active.delete(checkpoint.id); });
    return Object.freeze({ id: ticket.id, cancel: () => ticket.cancel(), done: committed });
  }

  return {
    /** Journal the frozen plan before accepting work into the Task Manager. */
    submit<Recipe, Output>(plan: DurableExportPlan<Recipe>, adapter: DurableExportAdapter<Recipe, Output>): ExportBatchTicket {
      if (active.has(plan.id) || resuming.has(plan.id) || journal.load(plan.id)) throw new Error('Export job ID already exists; resume explicitly.');
      const checkpoint: ExportQueueCheckpoint<Recipe> = {
        version: 1, id: plan.id, title: plan.title, items: plan.items.map(item => ({ ...item })),
        recipe: snapshotExportRecipe(plan.recipe), receipts: [], state: 'pending',
      };
      journal.save(checkpoint); // validates filenames, hashes and collisions
      try {
        return enqueueVerified(checkpoint, checkpoint.items.map((_, index) => index), adapter);
      } catch (error) {
        journal.pause(plan.id);
        throw error;
      }
    },
    /** Never resume without independently verifying originals and output receipts. */
    async resume<Recipe, Output>(id: string, adapter: DurableExportAdapter<Recipe, Output>): Promise<ExportBatchTicket | null> {
      if (active.has(id) || resuming.has(id)) throw new Error('This export is already running.');
      // Acquire synchronously before the first await: two resume calls must never
      // verify the same checkpoint in parallel and publish the same output twice.
      resuming.add(id);
      try {
        const { checkpoint, pending } = await journal.pendingForExplicitResume<Recipe>(
          id, adapter.verifySource, adapter.verifyOutput,
        );
        if (!pending.length) {
          // A crash after the last receipt but before the final state update
          // leaves a complete set of verified outputs and no work to enqueue.
          if (checkpoint.state !== 'completed') journal.save({ ...checkpoint, state: 'completed' });
          return null;
        }
        return enqueueVerified(checkpoint, pending, adapter);
      } finally {
        // Once enqueued, active owns the lease until ticket.done settles.
        // On verification failure the job remains available for explicit retry.
        resuming.delete(id);
      }
    },
    load: journal.load,
  };
}
