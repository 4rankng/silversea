/**
 * Seed forwarder (OPS) money flows through domain services:
 *   - advance requests: PENDING / APPROVED (with OPS_ADVANCE ledger) / REJECTED
 *   - trip expenses owned by the forwarder (PENDING/ APPROVED approval states)
 *   - one advance settlement linking APPROVED advances + their expenses
 *
 * Idempotent: keyed on advance reason strings + settlement note.
 *
 * Part of plans/260817-2148-seed-full-coverage.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import {
  createAdvanceRequest,
  createAdvanceSettlement,
} from '../services/advance.service';

export async function seedForwarderMoney(actors: {
  ops: number;
  approver: number;
}, opsExpenseIds: number[]): Promise<void> {
  await seedAdvances(actors);
  await seedSettlement(actors, opsExpenseIds);
}

async function seedAdvances(actors: { ops: number; approver: number }) {
  const plans = [
    { reason: 'Tạm ứng phí cầu đường + xăng chuyến Hải Phòng - Bắc Giang 17/08', amount: 6000000, decision: 'APPROVE' as const },
    { reason: 'Tạm ứng phí nâng hạ container cảng Đình Vũ 16/08', amount: 4500000, decision: 'APPROVE' as const },
    { reason: 'Tạm ứng chi phí phát sinh tuần 33', amount: 2000000, decision: 'REJECT' as const },
    { reason: 'Tạm ứng phí tolls + E5 theo tuyến NEWB 18/08', amount: 3500000, decision: 'PENDING' as const },
  ];

  let created = 0;
  for (const plan of plans) {
    const [existing] = await db.select({ id: s.advanceRequests.id })
      .from(s.advanceRequests).where(eq(s.advanceRequests.reason, plan.reason)).limit(1);
    if (existing) continue;

    const request = await createAdvanceRequest(actors.ops, {
      amount: plan.amount,
      reason: plan.reason,
    });
    created++;
  }
  console.log(`✅ Advance requests seeded! (${created} new)`);
}

async function seedSettlement(actors: { ops: number; approver: number }, opsExpenseIds: number[]) {
  const SETTLEMENT_NOTE = 'Quyet toan tam ung dot 16-17/08 (seed)';
  const [existing] = await db.select({ id: s.advanceSettlements.id })
    .from(s.advanceSettlements).where(eq(s.advanceSettlements.note, SETTLEMENT_NOTE)).limit(1);
  if (existing) {
    console.log('✅ Advance settlement already seeded.');
    return;
  }
  const approvedRequests = await db.select({ id: s.advanceRequests.id })
    .from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.requesterId, actors.ops),
      eq(s.advanceRequests.status, 'APPROVED'),
    ));
  if (approvedRequests.length === 0 || opsExpenseIds.length === 0) {
    console.warn('  ⚠️ Settlement seed: no approved advances or trip expenses');
    return;
  }
  await createAdvanceSettlement(actors.ops, {
    advanceRequestIds: approvedRequests.map(r => r.id),
    tripExpenseIds: opsExpenseIds,
    note: SETTLEMENT_NOTE,
  });
  console.log('✅ Advance settlement seeded!');
}
