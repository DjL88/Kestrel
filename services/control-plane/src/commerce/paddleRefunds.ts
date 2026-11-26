import { purchaseEntitlement } from '../entitlement.ts';
import type { AuditRecord, LicenceRecord, LicenceStatus } from '../store.ts';
import type { PaddleAdjustment, PaddleTransaction } from './paddle.ts';
import type { ProPurchaseOrder } from './proSettlement.ts';

/**
 * A full Paddle refund or a chargeback takes Pro away by itself (the admin used to do it by hand). Paddle is the
 * merchant of record and handles the money; this only keeps the licence honest.
 *
 * Trust rules, the same as for granting (proSettlement.ts):
 * - The route has already checked Paddle-Signature. The webhook body is still only a pointer: the adjustment and its
 *   transaction are fetched back from Paddle, and the transaction must be the one our order was opened for.
 * - Each Paddle event is acted on once (`events.claim`); revoking an already revoked licence is harmless anyway.
 * - Only an *approved* adjustment counts. A full refund or a chargeback removes Pro; a partial refund or a credit
 *   keeps it. Every decision that touches a Pro order is written to the audit log, which /admin shows, with the reason.
 * - A refund never touches photos, edits or anything on the person's devices; it only stops the online Pro licence.
 */
export type RefundOutcome = 'revoked' | 'kept' | 'pending' | 'ignored' | 'duplicate';

export interface RefundDependencies {
  findOrder(transactionId: string): Promise<ProPurchaseOrder | null>;
  paddle: { getAdjustment(id: string): Promise<PaddleAdjustment | null>; getTransaction(id: string): Promise<PaddleTransaction> };
  licences: {
    setLicenceStatus(licenceId: string, status: LicenceStatus, nowMs: number): Promise<boolean>;
    /** Keeps an existing licence as it is (never reactivates a revoked one). */
    grantLicence(licence: LicenceRecord): Promise<unknown>;
    audit(entry: AuditRecord): Promise<void>;
  };
  /** True the first time an event id is claimed. `release` gives it back after a failure, so Paddle's retry runs. */
  events: { claim(eventId: string, atMs: number): Promise<boolean>; release(eventId: string): Promise<void> };
  /** The sale in the commerce ledger (ledger.ts markRefunded), so refunded money stops counting as income. */
  commerce?: { markRefunded(checkoutReference: string, status: 'refunded' | 'partially-refunded'): Promise<boolean> };
  now: () => number;
}

/** The licence a Paddle Pro order grants (entitlement.ts purchaseEntitlement). */
export const paddleProLicenceId = (order: Pick<ProPurchaseOrder, 'reference'>) => `lic_p_${order.reference}`;

/** What an approved adjustment means for Pro. */
export function refundEffect(a: Pick<PaddleAdjustment, 'action' | 'type' | 'status'>): 'remove' | 'keep' | 'wait' | 'none' {
  if (a.action === 'chargeback') return a.status === 'approved' ? 'remove' : 'wait';
  if (a.action === 'refund') return a.status !== 'approved' ? 'wait' : a.type === 'full' ? 'remove' : 'keep';
  return 'none'; // credits, chargeback warnings and reversals never remove Pro on their own
}

export function paddleRefundRevocation(d: RefundDependencies) {
  const audit = (action: string, detail: string) => d.licences.audit({ atMs: d.now(), actor: 'paddle', action, outcome: 'allowed', detail: detail.slice(0, 480) });

  async function act(adjustmentId: string): Promise<Exclude<RefundOutcome, 'duplicate'>> {
    const a = await d.paddle.getAdjustment(adjustmentId);
    if (!a) throw new Error('Paddle has no such adjustment yet.'); // retried by Paddle
    const order = await d.findOrder(a.transaction_id);
    if (!order) return 'ignored'; // not a Pro purchase (cloud top-ups and subscriptions are handled elsewhere)
    const t = await d.paddle.getTransaction(a.transaction_id);
    if (t.id !== a.transaction_id || t.custom_data?.reference !== order.reference || t.custom_data?.accountId !== order.accountId) {
      throw new Error('The refunded Paddle transaction does not match the recorded order.');
    }
    const licenceId = paddleProLicenceId(order);
    const effect = refundEffect(a);
    const what = `${a.action}${a.type ? ` (${a.type})` : ''} ${a.id} on ${t.id}, ${a.totals?.total ?? '?'} ${a.totals?.currency_code ?? ''}`.trim();
    if (effect === 'wait') { await audit('licence.refund_pending', `${what}: ${a.status}; Pro unchanged until Paddle approves it.`); return 'pending'; }
    if (effect === 'keep') {
      await d.commerce?.markRefunded(order.reference, 'partially-refunded');
      await audit('licence.refund_partial', `${what}: a partial refund, so ${licenceId} keeps Pro.`);
      return 'kept';
    }
    if (effect === 'none') {
      if (a.action === 'chargeback_reverse') await audit('licence.chargeback_reversed', `${what}: the chargeback was reversed. Pro stays removed until an admin restores ${licenceId}.`);
      return 'ignored';
    }
    let changed = await d.licences.setLicenceStatus(licenceId, 'revoked', d.now());
    if (!changed) {
      // Refunded before Pro was granted (Paddle's notifications can arrive in any order). Write the order's licence
      // already revoked (never active, not even for a moment), so a late or repeated transaction.completed finds it
      // and cannot grant an active one. If completion won the race, grantLicence keeps that one and we revoke it below.
      await d.licences.grantLicence({ ...purchaseEntitlement({
        store: 'paddle', checkoutReference: order.reference, accountId: order.accountId, emailHash: order.emailHash, majorVersion: order.majorVersion,
      }, d.now()), status: 'revoked' });
      changed = await d.licences.setLicenceStatus(licenceId, 'revoked', d.now());
    }
    // After the licence, so a ledger failure (retried by Paddle) never leaves Pro on for refunded money.
    await d.commerce?.markRefunded(order.reference, 'refunded');
    await audit('licence.revoke', `${what}: ${a.action === 'chargeback' ? 'a chargeback' : 'a full refund'}, so Pro was removed from account ${order.accountId} (${licenceId}${changed ? '' : ', already revoked or missing'}).`);
    return 'revoked';
  }

  return async (eventId: string, adjustmentId: string): Promise<RefundOutcome> => {
    if (!(await d.events.claim(eventId, d.now()))) return 'duplicate';
    try {
      return await act(adjustmentId);
    } catch (error) {
      await d.events.release(eventId).catch(() => undefined);
      throw error;
    }
  };
}
