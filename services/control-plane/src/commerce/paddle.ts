/**
 * Paddle Billing (owner decision 12, 25 Nov 2026): Paddle is merchant of record, so it charges and remits VAT and
 * sales tax by country, issues the receipt and handles refunds. This file is the server side of that: verified
 * webhooks turn a completed transaction into the Pro licence, and a full refund or chargeback revokes it.
 * Sandbox first (KCP_PADDLE_ENV=sandbox). Keys come only from Secret Manager (infra/gcp/paddle.tf); none is committed.
 *
 * Trust rules:
 * - Every webhook is checked against the Paddle-Signature header (HMAC-SHA256 of "<ts>:<raw body>" with the
 *   notification secret), within five minutes of its timestamp. Anything else is refused before it is parsed.
 * - A transaction grants Pro only when it is `completed`, contains the configured Pro price, and carries the
 *   reference of an order this server created for a signed-in account (custom_data.reference). The order, not the
 *   webhook, says which account gets the licence, so a buyer cannot point a payment at someone else's account.
 * - Each event id is processed once; granting is idempotent anyway (one licence id per order reference).
 * - Partial refunds keep the licence; a full refund or a chargeback revokes it. Local and offline work never depend on
 *   any of this.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { purchaseEntitlement } from '../entitlement.ts';
import type { FirestoreLike } from '../firestoreStore.ts';
import type { LicenceRecord, Store } from '../store.ts';

export const PADDLE_SIGNATURE_TOLERANCE_S = 300;

/** True when `header` (Paddle-Signature: "ts=...;h1=...[;h1=...]") signs `rawBody` with `secret`, recently. */
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, nowMs: number, toleranceS = PADDLE_SIGNATURE_TOLERANCE_S): boolean {
  if (!header || !secret || header.length > 1000) return false;
  let ts = '';
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const [k, v] = part.split('=', 2).map((s) => s?.trim() ?? '');
    if (k === 'ts') ts = v;
    else if (k === 'h1' && /^[0-9a-f]{64}$/.test(v)) signatures.push(v);
  }
  if (!/^\d{1,12}$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > toleranceS) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex'));
  return signatures.some((s) => { const b = Buffer.from(s); return b.length === expected.length && timingSafeEqual(b, expected); });
}

/** A Paddle order this server created for a signed-in account (written by the checkout step). */
export interface PaddleOrder {
  reference: string;
  accountId: string;
  emailHash: string;
  majorVersion: number;
  priceId: string;
  createdAtMs: number;
}

export interface PaddleRecords {
  saveOrder(order: PaddleOrder): Promise<void>;
  getOrder(reference: string): Promise<PaddleOrder | null>;
  /** Remember which Paddle transaction paid which order (for refunds and the admin Payments table). */
  markPaid(reference: string, payment: { transactionId: string; currency: string; total: string; paidAt: string }): Promise<void>;
  orderForTransaction(transactionId: string): Promise<PaddleOrder | null>;
  /** True the first time an event id is claimed. */
  claimEvent(eventId: string, atMs: number): Promise<boolean>;
  /** Give an event back when handling failed, so Paddle's retry is processed. */
  releaseEvent(eventId: string): Promise<void>;
}

export class FirestorePaddleRecords implements PaddleRecords {
  constructor(private readonly db: FirestoreLike) {}
  private orders() { return this.db.collection('paddle_orders'); }
  async saveOrder(o: PaddleOrder) { await this.orders().doc(o.reference).create({ ...o }); }
  async getOrder(reference: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(reference)) return null;
    return ((await this.orders().doc(reference).get()).data() as PaddleOrder | undefined) ?? null;
  }
  async markPaid(reference: string, p: { transactionId: string; currency: string; total: string; paidAt: string }) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.orders().doc(reference);
      const o = (await tx.get(ref)).data();
      if (!o) return;
      tx.set(ref, { ...o, paid: p });
      tx.set(this.db.collection('paddle_transactions').doc(p.transactionId), { reference });
    });
  }
  async orderForTransaction(transactionId: string) {
    if (!/^txn_[A-Za-z0-9]{1,60}$/.test(transactionId)) return null;
    const link = (await this.db.collection('paddle_transactions').doc(transactionId).get()).data() as { reference?: string } | undefined;
    return link?.reference ? this.getOrder(link.reference) : null;
  }
  async claimEvent(eventId: string, atMs: number) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.collection('paddle_events').doc(eventId);
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, { atDay: new Date(atMs).toISOString().slice(0, 10) });
      return true;
    });
  }
  async releaseEvent(eventId: string) {
    await this.db.runTransaction(async (tx) => { tx.delete(this.db.collection('paddle_events').doc(eventId)); });
  }
}

export type PaddleOutcome = 'granted' | 'revoked' | 'duplicate' | 'ignored';

interface Dependencies {
  records: PaddleRecords;
  licences: Pick<Store, 'getAccount' | 'grantLicence' | 'setLicenceStatus'>;
  /** The Pro price (pri_...) in this Paddle environment. */
  proPriceId: string;
  now: () => number;
  /** Plain audit line: ids and outcomes only, never names, addresses or card details. */
  audit?: (outcome: PaddleOutcome, detail: string) => Promise<void>;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The licence an order grants: the same id whether it is granted once or by a retried webhook. */
export const paddleLicenceId = (reference: string) => `lic_p_${reference}`;

/** Handle one verified Paddle event (the route has already checked the signature). */
export function paddleSettlement(d: Dependencies) {
  const audit = d.audit ?? (async () => undefined);
  async function completed(data: Json): Promise<PaddleOutcome> {
    const transactionId = str(data.id);
    if (str(data.status) !== 'completed' || !transactionId.startsWith('txn_')) return 'ignored';
    const items = Array.isArray(data.items) ? data.items.map(obj) : [];
    if (!items.some((i) => str(obj(i.price).id) === d.proPriceId)) { await audit('ignored', `${transactionId} not the Pro price`); return 'ignored'; }
    const order = await d.records.getOrder(str(obj(data.custom_data).reference));
    if (!order) { await audit('ignored', `${transactionId} no InFlight order`); return 'ignored'; }
    const account = await d.licences.getAccount(order.accountId);
    if (!account || account.emailHash !== order.emailHash) throw new Error('Paddle payment has no matching account.');
    const paidAt = str(data.billed_at) || str(data.updated_at) || new Date(d.now()).toISOString();
    const licence: LicenceRecord = purchaseEntitlement({
      checkoutReference: order.reference, accountId: order.accountId, emailHash: order.emailHash, majorVersion: order.majorVersion,
    }, Number.isFinite(Date.parse(paidAt)) ? Date.parse(paidAt) : d.now());
    const totals = obj(obj(data.details).totals);
    await d.records.markPaid(order.reference, { transactionId, currency: str(data.currency_code), total: str(totals.grand_total) || str(totals.total), paidAt });
    await d.licences.grantLicence(licence);
    await audit('granted', `${transactionId} ${order.reference}`);
    return 'granted';
  }
  async function adjustment(data: Json): Promise<PaddleOutcome> {
    const action = str(data.action);
    const takesBack = (action === 'refund' && str(data.type) === 'full') || action === 'chargeback';
    if (!takesBack || str(data.status) !== 'approved') return 'ignored';
    const transactionId = str(data.transaction_id);
    const order = await d.records.orderForTransaction(transactionId);
    if (!order) { await audit('ignored', `${transactionId} ${action} for no InFlight order`); return 'ignored'; }
    await d.licences.setLicenceStatus(paddleLicenceId(order.reference), 'revoked', d.now());
    await audit('revoked', `${transactionId} ${action}`);
    return 'revoked';
  }
  return async (event: unknown): Promise<PaddleOutcome> => {
    const e = obj(event);
    const eventId = str(e.event_id);
    if (!/^evt_[A-Za-z0-9]{1,60}$/.test(eventId)) return 'ignored';
    const type = str(e.event_type);
    if (type !== 'transaction.completed' && type !== 'adjustment.created' && type !== 'adjustment.updated') return 'ignored';
    if (!(await d.records.claimEvent(eventId, d.now()))) return 'duplicate';
    try {
      return type === 'transaction.completed' ? await completed(obj(e.data)) : await adjustment(obj(e.data));
    } catch (error) {
      await d.records.releaseEvent(eventId); // Paddle retries; the next delivery is processed
      throw error;
    }
  };
}
