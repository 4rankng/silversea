import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, client } from '../db';
import * as s from '../db/schema';
import { loadDispatchExpenseNotes } from '../services/dispatch-expense-notes.service';
after(async () => { await client.end(); });
test('FIX17-DSP-01 dispatch projects canonical recorded recovery notes once, preserving lines and shipment boundaries', async () => {
  const rollback = Symbol('rollback');
  try { await db.transaction(async tx => {
    const key = crypto.randomUUID();
    const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
    const shipments = await tx.insert(s.shipments).values([{ customerId: customer.id, shipmentCode: key }, { customerId: customer.id, shipmentCode: key + 'b' }]).returning();
    const base = { shipmentId: shipments[0].id, expenseTypeCode: 'OTHER', amount: '500000', paidById: 1, paidAt: '2026-09-17' };
    await tx.insert(s.opsExpenseEntries).values([
      { ...base, recoveryNote: '  Khách trả theo chứng từ\nGiữ bản gốc  ', approvalStatus: 'RECORDED' },
      { ...base, recoveryNote: 'Khách trả theo chứng từ\nGiữ bản gốc', approvalStatus: 'RECORDED' },
      { ...base, recoveryNote: 'Đã hủy', approvalStatus: 'VOIDED' },
      { ...base, recoveryNote: 'Chưa nhập xong', approvalStatus: 'DRAFT' },
      { ...base, shipmentId: shipments[1].id, recoveryNote: 'Lô khác', approvalStatus: 'RECORDED' },
    ]);
    const rows = await loadDispatchExpenseNotes([shipments[0].id, shipments[0].id], tx);
    assert.deepEqual(rows.get(shipments[0].id), ['Khách trả theo chứng từ\nGiữ bản gốc']);
    assert.equal(rows.has(shipments[1].id), false);
    assert.equal((await loadDispatchExpenseNotes([], tx)).size, 0);
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
});

// Card 20260928_162 criterion 3 — a cost line that does NOT charge the
// customer must surface its REASON (the entry `note`) on both ruled surfaces,
// and nothing else may leak in its place: no amount, and no ordinary
// commentary from lines that DO charge.
test('card 20260928_162 — the not-charged line projects its reason, and only the reason', async () => {
  const rollback = Symbol('rollback');
  try { await db.transaction(async tx => {
    const key = crypto.randomUUID();
    const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
    const [shipment] = await tx.insert(s.shipments).values({ customerId: customer.id, shipmentCode: key }).returning();
    const base = { shipmentId: shipment.id, expenseTypeCode: 'OTHER', paidById: 1, paidAt: '2026-09-17', approvalStatus: 'RECORDED' as const };
    // The rows intentionally differ in which optional fields they carry (note,
    // feeName), so the array needs the insert type spelled out for drizzle's
    // values() inference.
    const entries: Array<typeof s.opsExpenseEntries.$inferInsert> = [
      // The ruled case: not charged, reason present.
      { ...base, amount: '500000', customerChargeAmount: '0', note: 'Đã bao gồm trong đơn giá trọn gói' },
      // Pre-guard rows exist (the guard landed after them): not charged, no
      // note — must add nothing, never a placeholder.
      { ...base, amount: '200000', customerChargeAmount: '0' },
      // A charged line's note is ordinary commentary, NOT a not-charged
      // reason; the charged family carries the fee name only.
      { ...base, amount: '300000', customerChargeAmount: '300000', feeName: 'Phí lưu bãi', note: 'Ghi chú nội bộ của kế toán' },
    ];
    await tx.insert(s.opsExpenseEntries).values(entries);
    const rows = await loadDispatchExpenseNotes([shipment.id], tx);
    assert.deepEqual(rows.get(shipment.id), [
      'Thu khách: Phí lưu bãi',
      'Đã bao gồm trong đơn giá trọn gói',
    ], 'the charged fee name and the uncharged reason are projected; the charged line\'s note and the noteless uncharged line are not');
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
});
