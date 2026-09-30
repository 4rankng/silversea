// Advisory locks — the one named module for pg_advisory_xact_lock.
//
// Before this module every service re-typed the lock SQL inline: nine magic
// family numbers, four incompatible key encodings, and deadlock-avoidance
// ordering that lived only as local habits. Two families could silently
// collide (nothing owned the number space) and a fifth encoding could appear
// at any call site. This module owns the encoding, the family constants, and
// the ordering rule; call sites name WHAT they lock, never HOW.
//
// Key spaces (postgres treats each arity as a separate space, so a two-int
// key can never collide with a single-bigint key):
//   int        pg_advisory_xact_lock(family, id)
//   hash       pg_advisory_xact_lock(family, hashtext(text))
//   text       pg_advisory_xact_lock(hashtextextended(text, 0))
//   dual-hash  pg_advisory_xact_lock(hashtext(a), hashtext(b))
//   bare-int   pg_advisory_xact_lock(id)
//
// The lock module is the only place raw lock SQL may appear (repo rule: no
// raw SQL in application behavior outside drizzle sql templates — this file
// is that template's single owner).
import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../db';

/**
 * Distinct-by-construction family numbers for the two-int key space.
 * Never reuse a number; add new families at the end of their group and keep
 * the unit test (families pairwise distinct) green.
 */
export const LOCK_FAMILY = {
  // Ledger entity rows (LedderService's historical entity-type map; numbers
  // predate this module and are frozen for lock-identity compatibility).
  ledgerCustomer: 1,
  ledgerDriver: 2,
  ledgerVendor: 3,
  ledgerForwarder: 4,
  ledgerCarrier: 5,
  ledgerOther: 6,
  // Monthly code counters (second slot is hashtext('<prefix>')).
  advanceSettlementCode: 6001,
  opsSettlementCode: 6301,
  // Trip/expense financial resources (second slot is the row id).
  advance: 6101,
  expense: 6102,
  containerScope: 6103,
  expensePhoto: 6111,
  tripFinancialAuthority: 6118,
  // Dispatch resources.
  dispatchResource: 6201,
  forwarderAccount: 6202,
  // Ops settlements.
  opsUser: 6302,
} as const;

export type LockFamily = (typeof LOCK_FAMILY)[keyof typeof LOCK_FAMILY];

/** Ledger entity types → their frozen family numbers. */
const LEDGER_ENTITY_FAMILY: Record<string, LockFamily> = {
  CUSTOMER: LOCK_FAMILY.ledgerCustomer,
  DRIVER: LOCK_FAMILY.ledgerDriver,
  VENDOR: LOCK_FAMILY.ledgerVendor,
  FORWARDER: LOCK_FAMILY.ledgerForwarder,
  CARRIER: LOCK_FAMILY.ledgerCarrier,
};

export type AdvisoryLockKey =
  | { readonly kind: 'int'; readonly family: LockFamily; readonly id: number }
  | { readonly kind: 'hash'; readonly family: LockFamily; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'dual-hash'; readonly a: string; readonly b: string }
  | { readonly kind: 'bare-int'; readonly id: number };

const intKey = (family: LockFamily, id: number): AdvisoryLockKey => ({ kind: 'int', family, id });
const hashKey = (family: LockFamily, text: string): AdvisoryLockKey => ({ kind: 'hash', family, text });
const textKey = (text: string): AdvisoryLockKey => ({ kind: 'text', text });

/**
 * Named lock keys — one builder per business resource. Call sites say what
 * they lock; the encoding stays here. Byte-for-byte compatible with the
 * inline SQL each site emitted before (lock identity is unchanged).
 */
export const lockKeys = {
  // ── Ledger entities ──────────────────────────────────────────────────────
  ledgerEntity: (entityType: string, entityId: number): AdvisoryLockKey =>
    intKey(LEDGER_ENTITY_FAMILY[entityType] ?? LOCK_FAMILY.ledgerOther, entityId),

  // ── Monthly code counters ────────────────────────────────────────────────
  advanceSettlementCodePrefix: (prefix: string): AdvisoryLockKey =>
    hashKey(LOCK_FAMILY.advanceSettlementCode, prefix),
  opsSettlementCodePrefix: (prefix: string): AdvisoryLockKey =>
    hashKey(LOCK_FAMILY.opsSettlementCode, prefix),

  // ── Trip / expense financial resources ───────────────────────────────────
  /** Serialize a single advance request/settlement row. */
  advance: (advanceRequestId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.advance, advanceRequestId),
  /** Serialize a single trip-expense row. */
  expense: (tripExpenseId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.expense, tripExpenseId),
  /**
   * Serialize a trip's container scope. The 6103 id is the container id, or
   * the NEGATED trip id when the expense has no container — the sign keeps
   * the trip-id and container-id number spaces from colliding.
   */
  containerScope: (containerId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.containerScope, containerId),
  tripScope: (tripId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.containerScope, -tripId),
  /** Serialize an expense's photo mutation. */
  expensePhoto: (photoId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.expensePhoto, photoId),
  /**
   * Shared serialization authority for a trip crossing the editable/issued
   * financial boundary. Every participant acquires keys in ascending trip
   * order (was trip-financial-authority-lock.service.ts's own namespace).
   */
  tripFinancialAuthority: (tripId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.tripFinancialAuthority, tripId),

  // ── Dispatch resources ───────────────────────────────────────────────────
  dispatchResource: (resourceId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.dispatchResource, resourceId),
  forwarderAccount: (forwarderId: number): AdvisoryLockKey =>
    intKey(LOCK_FAMILY.forwarderAccount, forwarderId),

  // ── Ops settlements ──────────────────────────────────────────────────────
  opsUser: (userId: number): AdvisoryLockKey => intKey(LOCK_FAMILY.opsUser, userId),

  // ── Single-bigint text keys (hashtextextended) ───────────────────────────
  paymentReceipt: (receiptId: number): AdvisoryLockKey =>
    textKey(`payment-receipt\u001f${receiptId}`),
  /**
   * Historical encoding has NO separator between name and id; kept
   * byte-identical so concurrent old/new code during a deploy still
   * serializes on the same lock.
   */
  paymentRefund: (paymentReceiptId: number): AdvisoryLockKey =>
    textKey(`payment-refund${paymentReceiptId}`),
  treasuryAccountSetup: (code: string): AdvisoryLockKey =>
    textKey(`treasury-account-setup\u001f${code}`),
  profitDistribution: (year: number, quarter: number): AdvisoryLockKey =>
    textKey(`profit-distribution\u001f${year}\u001f${quarter}`),
  masterImportFile: (sourceFileHash: string, parserVersion: string): AdvisoryLockKey =>
    textKey(`master-import:${sourceFileHash}:${parserVersion}`),
  masterDataImportApply: (): AdvisoryLockKey => textKey('master-data-import.apply'),
  shipmentCodeCounter: (yearMonth: string): AdvisoryLockKey =>
    textKey(`shipment_code_counter:${yearMonth}`),
  ocrSettingsCommand: (): AdvisoryLockKey => textKey('admin.ocr-settings.update'),
  /**
   * Escape hatch for caller-composed string keys (application-owned
   * uniqueness scopes, email/receivable-reminder dedup keys). The module
   * still owns the SQL; the caller owns the key's business bytes.
   */
  text: (key: string): AdvisoryLockKey => textKey(key),

  // ── Tire vehicle slots (two-slot hashed) ─────────────────────────────────
  tireVehicleSlot: (vehicleLockKey: string, position: string): AdvisoryLockKey =>
    ({ kind: 'dual-hash', a: vehicleLockKey, b: position }),

  // ── Single-int space (legacy) ────────────────────────────────────────────
  /**
   * Trip-status transitions lock the bare truck id (predates the family
   * numbering; a separate one-int key space, kept as-is for compatibility).
   */
  tripTruckTransition: (truckId: number): AdvisoryLockKey => ({ kind: 'bare-int', id: truckId }),
} as const;

/** The single owner of the lock SQL. No other file may spell this function. */
function lockStatement(key: AdvisoryLockKey): SQL {
  switch (key.kind) {
    case 'int':
      return sql`select pg_advisory_xact_lock(${key.family}, ${key.id})`;
    case 'hash':
      return sql`select pg_advisory_xact_lock(${key.family}, hashtext(${key.text}))`;
    case 'text':
      return sql`select pg_advisory_xact_lock(hashtextextended(${key.text}, 0))`;
    case 'dual-hash':
      return sql`select pg_advisory_xact_lock(hashtext(${key.a}), hashtext(${key.b}))`;
    case 'bare-int':
      return sql`select pg_advisory_xact_lock(${key.id})`;
  }
}

/**
 * Canonical multi-lock acquisition order, as data.
 *
 * The habits this formalizes (both pre-date the module):
 * - expense-accounting-reconciliation.service.ts sorted advance ids ascending;
 * - advance-settlement.service.ts sequenced advance → expense → scope,
 *   which is exactly family-number ascending (6101 < 6102 < 6103);
 * - LedgerService sorted (entity-type-key, entity-id) globally ascending.
 *
 * Rule: order keys by key space (int/hash families first, ascending family
 * number, then id ascending within a family), then the single-bigint text
 * space (by key bytes), then dual-hash, then bare-int. acquireAdvisoryLocks
 * applies it regardless of caller order, so composed commands cannot
 * dead-lock on ordering as long as they acquire through this helper.
 */
export const LOCK_ORDER = {
  kindRank: { int: 0, hash: 1, text: 2, 'dual-hash': 3, 'bare-int': 4 },
} as const;

function lockOrderRank(key: AdvisoryLockKey): [number, number, number | string] {
  switch (key.kind) {
    case 'int':
      // id stays NUMERIC: the container-scope family mixes positive container
      // ids with negated trip ids, and lexical order would mis-sort negatives.
      return [LOCK_ORDER.kindRank.int, key.family, key.id];
    case 'hash':
      return [LOCK_ORDER.kindRank.hash, key.family, key.text];
    case 'text':
      return [LOCK_ORDER.kindRank.text, 0, key.text];
    case 'dual-hash':
      return [LOCK_ORDER.kindRank['dual-hash'], 0, `${key.a}\u0000${key.b}`];
    case 'bare-int':
      return [LOCK_ORDER.kindRank['bare-int'], 0, key.id];
  }
}

/** Acquire one advisory lock on the given executor (pool or open transaction). */
export async function acquireAdvisoryLock(executor: Executor, key: AdvisoryLockKey): Promise<void> {
  await executor.execute(lockStatement(key));
}

/**
 * Acquire several advisory locks in the canonical order: deduplicated, then
 * sorted by LOCK_ORDER, then acquired sequentially. Callers that lock more
 * than one resource MUST use this helper (or pre-sort identically) — that is
 * the deadlock contract.
 */
export async function acquireAdvisoryLocks(executor: Executor, keys: readonly AdvisoryLockKey[]): Promise<void> {
  const ordered = canonicalLockOrder(keys);
  for (const key of ordered) {
    await acquireAdvisoryLock(executor, key);
  }
}

/** The declared ordering, as a pure function (unit-tested; used by callers that must interleave reads between locks). */
export function canonicalLockOrder(keys: readonly AdvisoryLockKey[]): AdvisoryLockKey[] {
  const unique = new Map<string, AdvisoryLockKey>();
  for (const key of keys) {
    const identity = JSON.stringify(key);
    if (!unique.has(identity)) unique.set(identity, key);
  }
  return [...unique.values()].sort((left, right) => {
    const [la, lb, lc] = lockOrderRank(left);
    const [ra, rb, rc] = lockOrderRank(right);
    if (la !== ra) return la - ra;
    if (lb !== rb) return lb - rb;
    // Third slots only compare within one key kind, so their types match.
    if (typeof lc === 'number' && typeof rc === 'number') return lc - rc;
    const ls = String(lc); const rs = String(rc);
    return ls < rs ? -1 : ls > rs ? 1 : 0;
  });
}
