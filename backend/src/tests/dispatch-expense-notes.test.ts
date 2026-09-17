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
