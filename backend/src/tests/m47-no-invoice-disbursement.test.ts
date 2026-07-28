/**
 * Wave 3 M4.7 (slice 1) — no-invoice disbursement enforcement tests.
 *
 * Verifies the July 27, 2026 Q12-Q14 rules for no-invoice disbursements:
 *   - only allowed categories can proceed without invoice
 *   - date/payee/reason/evidence are mandatory minimum evidence
 *   - onsite-photo evidence requires an uploaded photo
 *   - per-item approvals escalate above 5,000,000 VND
 *   - same-payee same-day same-category totals escalate above 10,000,000 VND
 *   - incomplete evidence is returned for supplementation, not hard-rejected
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { transitionApproval } from '../services/approval.service';
import {
  buildNoInvoicePolicySnapshotForExpenseInput,
  reviewNoInvoiceDisbursementApproval,
  getNoInvoiceDisbursementReport,
  DIRECTOR_THRESHOLD,
  DAY_AGGREGATE_THRESHOLD,
} from '../services/no-invoice-disbursement.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdFetIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdAuditIds: number[] = [];
const createdUserIds: number[] = [];
let makerId: number;
let approverId: number;

before(async () => {
  const users = await db.insert(s.users).values([
    { username: `m47-maker-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT' },
    { username: `m47-approver-${suffix}`, passwordHash: 'x', role: 'ADMIN' },
  ]).returning({ id: s.users.id });
  [makerId, approverId] = users.map(user => user.id);
  createdUserIds.push(...users.map(user => user.id));
});

async function mkFet(opts: {
  requiresInvoice?: boolean;
  substituteEvidenceAllowed?: boolean;
  noInvoiceEvidenceTypes?: string[];
  noInvoicePerItemLimit?: string;
  noInvoicePerDayLimit?: string;
  noInvoiceFinanceLeadApprovalTitle?: 'FINANCE_LEAD' | 'DIRECTOR';
  noInvoiceDirectorApprovalTitle?: 'FINANCE_LEAD' | 'DIRECTOR';
  tag: string;
}) {
  const code = `M47-${createdFetIds.length}-${opts.tag}-${suffix}`.slice(0, 50);
  const [fet] = await db.insert(s.forwarderExpenseTypes).values({
    code,
    name: `M47 type ${opts.tag} ${suffix}`,
    requiresInvoice: opts.requiresInvoice ?? false,
    substituteEvidenceAllowed: opts.substituteEvidenceAllowed ?? true,
    noInvoiceEvidenceTypes: opts.noInvoiceEvidenceTypes ?? ['RECEIPT', 'BANK_TRANSFER', 'SIGNED_CONFIRMATION'],
    noInvoicePerItemLimit: opts.noInvoicePerItemLimit,
    noInvoicePerDayLimit: opts.noInvoicePerDayLimit,
    noInvoiceFinanceLeadApprovalTitle: opts.noInvoiceFinanceLeadApprovalTitle,
    noInvoiceDirectorApprovalTitle: opts.noInvoiceDirectorApprovalTitle,
  }).returning();
  createdFetIds.push(fet.id);
  return fet;
}

async function mkTrip(opts: { withShipment?: boolean } = {}) {
  const [cust] = await db.insert(s.customers).values({ name: `M47 cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(cust.id);
  const [route] = await db.insert(s.routes).values({ name: `M47 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M47 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargo.id);
  let shipmentId: number | null = null;
  if (opts.withShipment) {
    const [shipment] = await db.insert(s.shipments).values({
      customerId: cust.id,
      shipmentCode: `M47-SHP-${suffix}-${createdShipmentIds.length}`.slice(0, 50),
      createdBy: makerId,
      updatedBy: makerId,
    }).returning({ id: s.shipments.id });
    shipmentId = shipment.id;
    createdShipmentIds.push(shipment.id);
  }
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M47-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    shipmentId,
    status: 'COMPLETED', departureDate: '2026-07-15', carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpense(opts: {
  tripId: number;
  expenseTypeCode: string;
  buyAmount?: string;
  expenseDate?: string | null;
  payeeName?: string | null;
  invoiceNumber?: string | null;
  note?: string | null;
  noInvoiceEvidenceTypes?: string[];
  approvalStatus?: string;
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    createdBy: makerId,
    expenseType: opts.expenseTypeCode,
    buyAmount: opts.buyAmount ?? '500000',
    sellAmount: '0',
    supplierId: null,
    expenseDate: 'expenseDate' in opts ? (opts.expenseDate ?? null) : '2026-07-15',
    payeeName: 'payeeName' in opts ? (opts.payeeName ?? null) : 'Nguyen Van A',
    invoiceNumber: opts.invoiceNumber ?? null,
    invoiceDate: opts.invoiceNumber ? '2026-07-15' : null,
    note: opts.note ?? null,
    noInvoiceEvidenceTypes: opts.noInvoiceEvidenceTypes ?? ['RECEIPT'],
    approvalStatus: opts.approvalStatus ?? 'PENDING',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

async function addExpensePhoto(expenseId: number) {
  await db.insert(s.tripExpensePhotos).values({
    tripExpenseId: expenseId,
    storageKey: `m47/${suffix}/${expenseId}.jpg`,
    uploadedBy: makerId,
  });
}

/** Run transitionApproval in a rollback-only tx so the guard fires but
 *  no PENDING row is left APPROVED. */
async function runApproveTx(
  expenseId: number,
  actorRole: 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' = 'ADMIN',
): Promise<{ outcome: 'APPROVED' | 'REJECTED' | 'RETURN_FOR_EVIDENCE' }> {
  let result: { outcome: 'APPROVED' | 'REJECTED' | 'RETURN_FOR_EVIDENCE' } | null = null;
  try {
    await db.transaction(async (tx) => {
      result = await transitionApproval(tx, {
        table: 'trip_expenses', id: expenseId, toStatus: 'APPROVED',
        actorId: approverId, actorRole,
      });
      throw new RollbackSentinel();
    });
  } catch (e) {
    if (e instanceof RollbackSentinel && result) return result;
    throw e;
  }
  throw new Error('Expected rollback sentinel');
}
class RollbackSentinel extends Error {}

after(async () => {
  const namePattern = `M47 %${suffix}%`;
  try {
    if (createdAuditIds.length > 0) await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpensePhotos).where(inArray(s.tripExpensePhotos.tripExpenseId, createdExpenseIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdFetIds.length > 0) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdFetIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) { console.warn('[m47] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M4.7 — reviewNoInvoiceDisbursementApproval', () => {
  test('requiresInvoice=true + missing invoice is rejected at create trust boundary', async () => {
    const fet = await mkFet({ requiresInvoice: true, tag: 'req-inv-create' });
    await assert.rejects(
      () => buildNoInvoicePolicySnapshotForExpenseInput(db, {
        expenseType: fet.code,
        invoiceNumber: null,
      }),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /bắt buộc phải có hóa đơn/.test(err.message),
    );
  });

  test('policy snapshot exposes accepted default aliases, explicit scope, and exception governance metadata', async () => {
    const fet = await mkFet({ tag: 'snapshot-aliases' });
    const snapshot = await buildNoInvoicePolicySnapshotForExpenseInput(db, {
      expenseType: fet.code,
      invoiceNumber: null,
    });
    assert.ok(snapshot);
    assert.deepEqual(snapshot.allowedEvidenceTypes, ['RECEIPT', 'BANK_TRANSFER', 'SIGNED_CONFIRMATION']);
    assert.deepEqual(snapshot.defaultCategoryAliases, [fet.name], 'custom categories fall back to the configured name');
    assert.equal(snapshot.requiredScope, 'TRIP_OR_SHIPMENT');
    assert.equal(snapshot.financeLeadApprovalTitle, 'FINANCE_LEAD');
    assert.equal(snapshot.directorApprovalTitle, 'DIRECTOR');
    assert.equal(snapshot.exceptionReasonRequiredWhenThresholdExceeded, true);
  });

  test('requiresInvoice=true + missing invoice is rejected again at approval trust boundary', async () => {
    const fet = await mkFet({ requiresInvoice: true, tag: 'req-inv-approve' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      note: 'attempted API bypass',
    });
    await assert.rejects(
      () => reviewNoInvoiceDisbursementApproval(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /bắt buộc phải có hóa đơn/.test(err.message),
    );
  });

  test('substituteEvidenceAllowed=false + no invoice → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: false, tag: 'no-sub' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: 'has note' });
    await assert.rejects(
      () => reviewNoInvoiceDisbursementApproval(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /không cho phép chi hộ không hóa đơn/.test(err.message),
    );
  });

  test('missing minimum evidence returns for supplementation', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'no-note' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      expenseDate: null,
      payeeName: '   ',
      note: '   ',
      noInvoiceEvidenceTypes: [],
    });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'ADMIN');
    assert.equal(outcome.outcome, 'RETURN_FOR_EVIDENCE');
    assert.match(outcome.returnReason, /ngày chi/);
    assert.match(outcome.returnReason, /người nhận/);
    assert.match(outcome.returnReason, /lý do/);
    assert.match(outcome.returnReason, /bằng chứng/);
  });

  test('onsite photo evidence requires uploaded photo', async () => {
    const fet = await mkFet({
      substituteEvidenceAllowed: true,
      noInvoiceEvidenceTypes: ['ONSITE_PHOTO'],
      tag: 'needs-photo',
    });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      note: 'boc xep tai bai',
      noInvoiceEvidenceTypes: ['ONSITE_PHOTO'],
    });
    const beforePhoto = await reviewNoInvoiceDisbursementApproval(e.id, 'ADMIN');
    assert.equal(beforePhoto.outcome, 'RETURN_FOR_EVIDENCE');
    assert.match(beforePhoto.returnReason, /ảnh hiện trường/);
    await addExpensePhoto(e.id);
    const afterPhoto = await reviewNoInvoiceDisbursementApproval(e.id, 'ADMIN');
    assert.equal(afterPhoto.outcome, 'ALLOW');
  });

  test('allowed + minimum evidence + amount ≤ threshold → allow', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'ok' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '500000', note: 'biên nhận bốc xếp' });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT');
    assert.equal(outcome.outcome, 'ALLOW');
    assert.equal(outcome.aggregateAmount, 500000);
    assert.equal(outcome.exceedsPerItemLimit, false);
    assert.equal(outcome.exceedsPerDayLimit, false);
    assert.equal(outcome.requiredApprovalTitle, null);
    assert.equal(outcome.requiresExceptionReason, false);
  });

  test('configured Q13 per-item and per-day caps are reflected in approval decision and finance-lead title requirement', async () => {
    const fet = await mkFet({
      substituteEvidenceAllowed: true,
      noInvoicePerItemLimit: '400000',
      noInvoicePerDayLimit: '700000',
      tag: 'configured-caps',
    });
    const trip = await mkTrip();
    await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '300000',
      expenseDate: '2026-07-19',
      payeeName: 'Nguyen Van C',
      note: 'dot 1',
      approvalStatus: 'APPROVED',
    });
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '500000',
      expenseDate: '2026-07-19',
      payeeName: '  NGUYEN   VAN C ',
      note: 'Chi cùng ngày vượt ngưỡng chuẩn nhưng vẫn trong thẩm quyền tài chính',
    });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT');
    assert.equal(outcome.outcome, 'ALLOW');
    assert.equal(outcome.aggregateAmount, 800000);
    assert.equal(outcome.exceedsPerItemLimit, true);
    assert.equal(outcome.exceedsPerDayLimit, true);
    assert.equal(outcome.requiredApprovalTitle, 'FINANCE_LEAD');
    assert.equal(outcome.requiresExceptionReason, true);
  });

  test('configured approval titles are routed from category policy instead of hard-coded defaults', async () => {
    const fet = await mkFet({
      substituteEvidenceAllowed: true,
      noInvoicePerItemLimit: '400000',
      noInvoiceFinanceLeadApprovalTitle: 'DIRECTOR',
      tag: 'configured-title-routing',
    });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '500000',
      note: 'Chi phát sinh vượt ngưỡng hạng mục nên phải trình đúng chức danh đã cấu hình',
    });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'MANAGER');
    assert.equal(outcome.outcome, 'ALLOW');
    assert.equal(outcome.policySnapshot?.financeLeadApprovalTitle, 'DIRECTOR');
    assert.equal(outcome.requiredApprovalTitle, 'DIRECTOR');
  });

  test('amount > DIRECTOR_THRESHOLD + ACCOUNTANT → blocked (needs director)', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'over-thr' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 1), note: 'big no-invoice',
    });
    await assert.rejects(
      () => reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403 && /cần giám đốc/.test(err.message),
    );
  });

  test('over-threshold expense without an explicit exception reason is returned for evidence', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'missing-exception-reason' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '1500000',
      note: 'gấp',
    });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT');
    assert.equal(outcome.outcome, 'RETURN_FOR_EVIDENCE');
    assert.equal(outcome.requiredApprovalTitle, 'FINANCE_LEAD');
    assert.equal(outcome.requiresExceptionReason, true);
    assert.match(outcome.returnReason, /lý do ngoại lệ/i);
  });

  test('same payee/date/category aggregate > 10,000,000 VND + ACCOUNTANT → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'daily-over' });
    const trip = await mkTrip();
    await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '6000000',
      expenseDate: '2026-07-18',
      payeeName: 'Tran Thi B',
      note: 'dot 1',
      approvalStatus: 'APPROVED',
    });
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: String(DAY_AGGREGATE_THRESHOLD - 6_000_000 + 1),
      expenseDate: '2026-07-18',
      payeeName: 'Tran Thi B',
      note: 'Chi bổ sung cùng ngày do bốc xếp phát sinh ngoài kế hoạch đã duyệt',
    });
    await assert.rejects(
      () => reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403 && /tổng ngày/.test(err.message),
    );
  });

  test('amount > DIRECTOR_THRESHOLD + MANAGER → allow', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'mgr-ok' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 1_000_000),
      note: 'Chi bốc xếp ca đêm phát sinh ngoài định mức do tàu đổi lịch cập bến',
    });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'MANAGER');
    assert.equal(outcome.outcome, 'ALLOW');
    assert.equal(outcome.requiredApprovalTitle, 'DIRECTOR');
    assert.equal(outcome.requiresExceptionReason, true);
  });

  test('has-invoice expense → bypass (M4.6 owns it)', async () => {
    const fet = await mkFet({ requiresInvoice: true, substituteEvidenceAllowed: false, tag: 'has-inv' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      invoiceNumber: 'INV-1', note: null,
    });
    const outcome = await reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT');
    assert.equal(outcome.outcome, 'ALLOW');
  });

  test('unknown expense code → blocked until category policy exists', async () => {
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: `NOPE-${suffix}`, note: null });
    await assert.rejects(
      () => reviewNoInvoiceDisbursementApproval(e.id, 'ACCOUNTANT'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /chưa được cấu hình/.test(err.message),
    );
  });

  test('missing expense → no-op (let downstream 404 fire)', async () => {
    const outcome = await reviewNoInvoiceDisbursementApproval(99_999_999, 'ADMIN');
    assert.equal(outcome.outcome, 'ALLOW');
  });
});

describe('M4.7 — transitionApproval wiring', () => {
  test('APPROVE no-invoice expense with substituteEvidenceAllowed=false → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: false, tag: 'wire-block' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: 'note' });
    await assert.rejects(
      () => runApproveTx(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });

  test('APPROVE incomplete no-invoice expense → returned for evidence', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-return' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      note: 'missing evidence list',
      noInvoiceEvidenceTypes: [],
    });
    await db.transaction(async (tx) => {
      const result = await transitionApproval(tx, {
        table: 'trip_expenses',
        id: e.id,
        toStatus: 'APPROVED',
        actorId: approverId,
        actorRole: 'ADMIN',
      });
      assert.equal(result.outcome, 'RETURN_FOR_EVIDENCE');
      const [updated] = await tx.select({
        approvalStatus: s.tripExpenses.approvalStatus,
        returnForEvidenceReason: s.tripExpenses.returnForEvidenceReason,
        returnedForEvidenceAt: s.tripExpenses.returnedForEvidenceAt,
      }).from(s.tripExpenses).where(sql`${s.tripExpenses.id} = ${e.id}`).limit(1);
      assert.equal(updated?.approvalStatus, 'RETURN_FOR_EVIDENCE');
      assert.match(updated?.returnForEvidenceReason ?? '', /bằng chứng/);
      assert.ok(updated?.returnedForEvidenceAt);
      throw new RollbackSentinel();
    }).catch((err) => {
      if (!(err instanceof RollbackSentinel)) throw err;
    });
  });

  test('APPROVE no-invoice expense with allowed + evidence + small amount → succeeds', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-ok' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '300000', note: 'biên nhận' });
    const result = await runApproveTx(e.id, 'ACCOUNTANT');
    assert.equal(result.outcome, 'APPROVED');
  });

  test('APPROVE over-threshold no-invoice by ACCOUNTANT → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-over' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 500_000),
      note: 'Chi phát sinh ngoài định mức nhưng chưa đủ thẩm quyền tài chính',
    });
    await assert.rejects(
      () => runApproveTx(e.id, 'ACCOUNTANT'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403,
    );
  });

  test('APPROVE over-threshold no-invoice by MANAGER → succeeds', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-mgr' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 500_000),
      note: 'Xử lý khẩn cấp tại cảng sau giờ làm, cần duy trì tiến độ giao hàng',
    });
    const result = await runApproveTx(e.id, 'MANAGER');
    assert.equal(result.outcome, 'APPROVED');
  });

  test('REJECT bypasses the guard', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: false, tag: 'wire-reject' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: null });
    try {
      await db.transaction(async (tx) => {
        await transitionApproval(tx, {
          table: 'trip_expenses', id: e.id, toStatus: 'REJECTED',
          actorId: approverId, actorRole: 'ACCOUNTANT',
        });
        throw new RollbackSentinel();
      });
    } catch (err) {
      if (!(err instanceof RollbackSentinel)) throw err;
    }
  });
});

// ─── Slice 2: no-invoice disbursement report ────────────────────────────────

describe('M4.7 slice 2 — getNoInvoiceDisbursementReport', () => {
  test('empty range → empty report', async () => {
    const report = await getNoInvoiceDisbursementReport({ from: '1970-01-01', to: '1970-01-02' });
    assert.equal(report.items.length, 0);
    assert.equal(report.totals.count, 0);
    assert.equal(report.totals.sumBuyAmount, 0);
  });

  test('lists APPROVED no-invoice expenses with type name + trip code', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-list' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '300000', note: 'biên nhận bốc xếp',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item, 'expense appears in report');
    assert.equal(item!.expenseTypeName, fet.name);
    assert.equal(item!.tripCode, trip.tripCode);
    assert.equal(item!.buyAmount, 300_000);
    assert.equal(item!.note, 'biên nhận bốc xếp');
    assert.equal(item!.overThreshold, false);
  });

  test('report preserves shipment linkage for shipment-rooted no-invoice expenses', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-shipment-link' });
    const trip = await mkTrip({ withShipment: true });
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '300000',
      note: 'Biên nhận chi cho lô hàng gắn chuyến',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.tripId, trip.id);
    assert.equal(item!.shipmentId, trip.shipmentId);
    assert.ok(item!.shipmentId, 'shipment linkage is exposed on the returned boundary');
  });

  test('excludes expenses WITH an invoice number', async () => {
    const fet = await mkFet({ requiresInvoice: true, substituteEvidenceAllowed: true, tag: 'rpt-excl' });
    const trip = await mkTrip();
    await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      invoiceNumber: 'INV-RPT', buyAmount: '500000',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const hasInv = report.items.some(i => i.expenseTypeCode === fet.code);
    assert.equal(hasInv, false, 'invoiced expense excluded from no-invoice report');
  });

  test('excludes non-APPROVED expenses', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-pending' });
    const trip = await mkTrip();
    await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '100000', note: 'pending', approvalStatus: 'PENDING',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const hasPending = report.items.some(i => i.expenseTypeCode === fet.code);
    assert.equal(hasPending, false, 'PENDING expense excluded');
  });

  test('traces to approver via audit log', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-audit' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '200000', note: 'có biên nhận', approvalStatus: 'APPROVED',
    });
    // Insert a fake audit log entry simulating the approval.
    const [audit] = await db.insert(s.auditLogs).values({
      userId: 1,
      actorName: 'Admin Test',
      entityType: 'trip-expenses',
      entityId: e.id,
      message: 'Admin Test đã phê duyệt chi phí',
    }).returning();
    createdAuditIds.push(audit.id);

    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.approverId, 1);
    assert.equal(item!.approverName, 'Admin Test');
    assert.ok(item!.approvedAt);
  });

  test('expense without audit entry → approverId=null (legacy data)', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-no-audit' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '150000', note: 'no audit trail', approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.approverId, null);
    assert.equal(item!.approverName, null);
  });

  test('overThreshold flag set when buyAmount > DIRECTOR_THRESHOLD', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-over' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 1_000_000), note: 'big',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.overThreshold, true);
    const matchingItems = report.items.filter(i => i.expenseTypeCode === fet.code);
    assert.equal(matchingItems.length, 1);
    assert.equal(matchingItems[0]!.buyAmount, DIRECTOR_THRESHOLD + 1_000_000);
  });

  test('approverId filter narrows to one approver', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-filter' });
    const trip = await mkTrip();
    const e1 = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '100000', note: 'a', approvalStatus: 'APPROVED',
    });
    const e2 = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '200000', note: 'b', approvalStatus: 'APPROVED',
    });
    // Audit for e1 only → approverId=999.
    const [audit] = await db.insert(s.auditLogs).values({
      userId: 999, actorName: 'User 999',
      entityType: 'trip-expenses', entityId: e1.id,
      message: 'User 999 đã phê duyệt chi phí',
    }).returning();
    createdAuditIds.push(audit.id);

    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today, approverId: 999 });
    const ids = report.items.map(i => i.expenseId);
    assert.ok(ids.includes(e1.id));
    assert.ok(!ids.includes(e2.id), 'e2 (no audit by 999) excluded');
  });

  test('totals aggregate correctly', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-totals' });
    const trip = await mkTrip();
    await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '100000', note: 'x', approvalStatus: 'APPROVED' });
    await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '200000', note: 'y', approvalStatus: 'APPROVED' });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const mine = report.items.filter(i => i.expenseTypeCode === fet.code);
    assert.equal(mine.length, 2);
    const mySum = mine.reduce((s, i) => s + i.buyAmount, 0);
    assert.equal(mySum, 300_000);
  });
});
