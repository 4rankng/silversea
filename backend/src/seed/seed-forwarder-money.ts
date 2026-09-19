/**
 * Seed forwarder (OPS) money flows through domain services:
 *   - directly recorded advance requests and their ledger entries
 *   - completed forwarder expenses with physical evidence
 *   - one balanced settlement including the unused cash returned
 *
 * Idempotent: scoped to the fixture owner, exact advance plans and settlement note.
 *
 * Part of plans/260817-2148-seed-full-coverage.
 */
import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { getAdvanceFundedAmounts } from '../services/advance-funding.service';
import { type ExpenseActor } from '../services/expense-accounting-write.service';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import {
  createAdvanceRequest,
  createAdvanceSettlement,
} from '../services/advance.service';

export const OPS_EXPENSE_PLANS = [
  { ref: '105254549001', expenseType: 'LIFTING', buyAmount: '1650000', sellAmount: '1800000',
    payeeName: 'Trạm nâng hạ cảng Đình Vũ', invoiceNumber: null,
    noInvoiceEvidenceTypes: ['RECEIPT'], note: 'Phí nâng container cảng Đình Vũ' },
  { ref: '105254549088', expenseType: 'OTHER', buyAmount: '820000', sellAmount: '900000',
    payeeName: null, invoiceNumber: 'BOT-2026-008812',
    noInvoiceEvidenceTypes: [], note: 'Phí cầu đường BOT QL5' },
];

/** Recover only unchanged, unclaimed demo fees after an interrupted seed. */
export async function findUnsettledSeedExpenses(opsId: number) {
  const result: { id: number; amount: string }[] = [];
  for (const plan of OPS_EXPENSE_PLANS) {
    const rows = await db.select({ id: s.tripExpenses.id, amount: s.tripExpenses.buyAmount })
      .from(s.tripExpenses)
      .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
      .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
      .where(and(
        eq(s.tripExpenses.forwarderId, opsId),
        // The original seeder omitted createdBy; do not reinterpret another maker's entry.
        or(eq(s.tripExpenses.createdBy, opsId), isNull(s.tripExpenses.createdBy)),
        eq(s.tripExpenses.approvalStatus, 'RECORDED'),
        eq(s.tripExpenses.settlementMethod, 'OPS_ADVANCE'),
        eq(s.tripExpenses.expenseDate, '2026-08-16'),
        eq(s.tripExpenses.expenseType, plan.expenseType),
        eq(s.tripExpenses.buyAmount, plan.buyAmount),
        eq(s.tripExpenses.sellAmount, plan.sellAmount),
        eq(s.tripExpenses.note, plan.note),
        plan.payeeName === null ? isNull(s.tripExpenses.payeeName) : eq(s.tripExpenses.payeeName, plan.payeeName),
        plan.invoiceNumber === null ? isNull(s.tripExpenses.invoiceNumber) : eq(s.tripExpenses.invoiceNumber, plan.invoiceNumber),
        isNull(s.tripExpenses.tripContainerId),
        eq(s.trips.status, 'COMPLETED'),
        inArray(s.trips.createdBy, db.select({ id: s.users.id }).from(s.users).where(and(
          eq(s.users.username, 'dieuvan'), eq(s.users.role, 'DISPATCHER'), isNull(s.users.deletedAt),
        ))),
        isNull(s.trips.deletedAt), isNull(s.shipments.deletedAt),
        or(eq(s.shipments.blNumber, plan.ref), eq(s.shipments.bookingRef, plan.ref)),
        inArray(s.trips.shipmentId, db.select({ id: s.userShipmentLinks.shipmentId })
          .from(s.userShipmentLinks).where(eq(s.userShipmentLinks.userId, opsId))),
        notInArray(s.tripExpenses.id, db.select({ id: s.settlementExpenses.tripExpenseId })
          .from(s.settlementExpenses)
          .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
          .where(notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']))),
      ));
    if (rows.length > 1) throw new Error(`Ambiguous OPS seed expense for ${plan.ref}; reconcile duplicates before seeding.`);
    result.push(...rows);
  }
  return result;
}

export async function seedForwarderMoney(actors: {
  ops: number;
  approver: number;
}, opsExpenseIds: number[]): Promise<void> {
  await seedAdvances(actors);
  await seedAdvanceFunding(actors);
  await seedSettlement(actors, opsExpenseIds);
}

/** Advances must be FUNDED by confirmed treasury disbursements before the
 *  settlement can apply — on a fresh database nothing funded them, so the
 *  settlement silently skipped and the demo lost its O2C money chain. The
 *  funding goes through the app's own reconciliation writer (ledger entry +
 *  POSTED treasury movement), once per seeded advance. */
async function seedAdvanceFunding(actors: { ops: number; approver: number }): Promise<void> {
  const approver: ExpenseActor = { userId: actors.approver, role: Role.ADMIN };
  const [existing] = await db.select({ id: s.treasuryAccounts.id }).from(s.treasuryAccounts)
    .where(eq(s.treasuryAccounts.code, 'SEED-FUND')).limit(1);
  let treasuryAccountId = existing?.id;
  if (!treasuryAccountId) {
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: 'SEED-FUND',
      name: 'Quỹ demo (seed)',
      type: 'CASH',
      fundCode: 'COMPANY',
      status: 'ACTIVE',
      createdBy: actors.approver,
      updatedBy: actors.approver,
    }).returning();
    treasuryAccountId = account.id;
  }
  const requests = await db.select({ id: s.advanceRequests.id, amount: s.advanceRequests.amount, reason: s.advanceRequests.reason })
    .from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.requesterId, actors.ops),
      eq(s.advanceRequests.status, 'RECORDED'),
      or(...SEED_ADVANCES.map(plan => and(
        eq(s.advanceRequests.reason, plan.reason), eq(s.advanceRequests.amount, String(plan.amount)),
      ))),
    ));
  let fundedCount = 0;
  for (const plan of SEED_ADVANCES) {
    const request = requests.find(r => r.reason === plan.reason && Number(r.amount) === plan.amount);
    if (!request) continue;
    const funded = await getAdvanceFundedAmounts(db, [request.id]);
    if ((funded.get(request.id) ?? 0) >= Number(request.amount)) continue;
    await db.transaction(async (tx) => {
      await recordFundedOpsAdvance(tx, approver, {
        opsUserId: actors.ops,
        amount: plan.amount,
        reason: plan.reason,
        advanceRequestId: request.id,
        treasuryAccountId,
        valueDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
        physicalReference: `SEED-FUND-${request.id}`,
      });
    });
    fundedCount++;
  }
  console.log(`✅ Advance funding seeded! (${fundedCount} advances funded)`);
}

const SEED_ADVANCES = [
    { reason: 'Tạm ứng phí cầu đường + xăng chuyến Hải Phòng - Bắc Giang 17/08', amount: 6000000 },
    { reason: 'Tạm ứng phí nâng hạ container cảng Đình Vũ 16/08', amount: 4500000 },
    { reason: 'Tạm ứng chi phí phát sinh tuần 33', amount: 2000000 },
    { reason: 'Tạm ứng phí tolls + E5 theo tuyến NEWB 18/08', amount: 3500000 },
];

async function seedAdvances(actors: { ops: number; approver: number }) {
  let created = 0;
  for (const plan of SEED_ADVANCES) {
    const [existing] = await db.select({ id: s.advanceRequests.id })
      .from(s.advanceRequests).where(and(
        eq(s.advanceRequests.requesterId, actors.ops),
        eq(s.advanceRequests.reason, plan.reason),
      )).limit(1);
    if (existing) continue;

    await createAdvanceRequest(actors.ops, {
      amount: plan.amount,
      reason: plan.reason,
    });
    created++;
  }
  console.log(`✅ Advance requests seeded! (${created} new)`);
}

async function seedSettlement(actors: { ops: number; approver: number }, opsExpenseIds: number[]) {
  const SETTLEMENT_NOTE = 'Quyet toan tam ung dot 16-17/08 (seed)';
  const [existing] = await db.select({ id: s.advanceSettlements.id, status: s.advanceSettlements.status })
    .from(s.advanceSettlements).where(and(
      eq(s.advanceSettlements.forwarderId, actors.ops),
      eq(s.advanceSettlements.note, SETTLEMENT_NOTE),
    )).limit(1);
  if (existing) {
    if (existing.status !== 'RECORDED') {
      console.warn(`  ⚠️ Settlement seed ${existing.id} already exists as ${existing.status}; left unchanged.`);
      return;
    }
    console.log('✅ Advance settlement already seeded.');
    return;
  }
  const recordedRequests = await db.select({ id: s.advanceRequests.id, amount: s.advanceRequests.amount, reason: s.advanceRequests.reason })
    .from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.requesterId, actors.ops),
      eq(s.advanceRequests.status, 'RECORDED'),
      or(...SEED_ADVANCES.map(plan => and(
        eq(s.advanceRequests.reason, plan.reason), eq(s.advanceRequests.amount, String(plan.amount)),
      ))),
      notInArray(s.advanceRequests.id, db.select({ id: s.advanceSettlementRequests.advanceRequestId })
        .from(s.advanceSettlementRequests)
        .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
        .where(notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']))),
    ));
  const expenseRows = (await findUnsettledSeedExpenses(actors.ops)).filter(row => opsExpenseIds.includes(row.id));
  if (new Set(recordedRequests.map(row => row.reason)).size !== recordedRequests.length) {
    throw new Error('Ambiguous OPS seed advances; reconcile duplicates before seeding.');
  }
  if (recordedRequests.length !== SEED_ADVANCES.length || expenseRows.length !== OPS_EXPENSE_PLANS.length) {
    console.warn('  ⚠️ Settlement seed: exact unclaimed demo advances or trip expenses are incomplete; left unchanged.');
    return;
  }
  const refundAmount = recordedRequests.reduce((sum, row) => sum + Number(row.amount), 0)
    - expenseRows.reduce((sum, row) => sum + Number(row.amount), 0);
  if (refundAmount < 0) throw new Error('Settlement demo advances must cover the selected expenses.');
  await createAdvanceSettlement(actors.ops, {
    refundAmount,
    advanceRequestIds: recordedRequests.map(r => r.id),
    tripExpenseIds: expenseRows.map(row => row.id),
    note: SETTLEMENT_NOTE,
  });
  console.log('✅ Advance settlement seeded!');
}
