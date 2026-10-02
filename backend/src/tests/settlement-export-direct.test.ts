import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import { client, db } from '../db';
import * as s from '../db/schema';
import { formatVND } from '../lib/format';
import { insertTripComposite } from '../services/trip-composite.service';
import { getAdvanceSettlement } from '../services/advance-settlement.service';
import {
  buildSettlementExportData,
  renderSettlementHtml,
  renderSettlementXlsx,
  type SettlementExportData,
} from '../services/settlement-export.service';

after(async () => { await client.end(); });

// NO-APP-21/23: exercise both real renderers; no approval or cash mutation.
test('settlement print and spreadsheet retain the same money and business signatures', async () => {
  const data: SettlementExportData = {
    id: 1,
    code: 'QA-SETTLEMENT-EXPORT',
    createdAt: '2026-09-17T01:00:00.000Z',
    forwarderName: 'OPS <QA>',
    refundAmount: '100000',
    note: 'Đã đối chiếu chứng từ',
    linkedRequests: [{ amount: '1000000', reason: 'Ứng làm hàng', createdAt: '2026-09-16' }],
    linkedExpenses: [{
      id: 1, tripId: 1, expenseType: 'LIFTING', amount: '600000',
      containerNumber: 'QA-CONT-1', invoiceNumber: 'QA-INV-1', note: null,
      createdAt: '2026-09-17', departureDate: '2026-09-17', customerName: 'Khách <QA>',
    }],
  };
  const html = await renderSettlementHtml(data);
  assert.match(html, /OPS &lt;QA&gt;/);
  assert.match(html, /Khách &lt;QA&gt;/);
  assert.match(html, /Người giao nhận/);
  assert.doesNotMatch(html, /duyệt|Quản lý/i);
  for (const amount of [1_000_000, 600_000, 100_000, 300_000]) {
    assert.ok(html.includes(formatVND(amount, true)), `HTML contains ${amount}`);
  }

  const chunks: Buffer[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) {
    chunks.push(Buffer.from(chunk));
    callback();
  } });
  assert.equal(await renderSettlementXlsx(data, output), true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(Buffer.concat(chunks)).buffer);
  const sheet = workbook.worksheets[0];
  const values: string[] = [];
  const summary = new Map<string, number>();
  sheet.eachRow(row => {
    row.eachCell(cell => values.push(String(cell.value ?? '')));
    summary.set(String(row.getCell(1).value ?? ''), Number(row.getCell(5).value));
  });
  assert.equal(summary.get('Tổng tạm ứng đã sử dụng'), 1_000_000);
  assert.equal(summary.get('Tổng chi phí phát sinh'), 600_000);
  assert.equal(summary.get('Tiền hoàn lại'), 100_000);
  assert.equal(summary.get('Còn dư (phải hoàn lại)'), 300_000);
  for (const label of ['Người lập phiếu', 'Kế toán đối chiếu', 'Người giao nhận']) {
    assert.ok(values.includes(label));
  }
  assert.equal(values.some(value => /duyệt|Quản lý/i.test(value)), false);
  assert.ok(values.includes('QA-CONT-1'));
  assert.ok(values.includes('QA-INV-1'));
});

test('NO-APP-23A persisted settlement exports allocated advances and recorded cost snapshots', async () => {
  const rollback = Symbol('rollback settlement export fixture');
  try {
    await db.transaction(async tx => {
      const key = crypto.randomUUID();
      const [user] = await tx.insert(s.users).values({ username: key, passwordHash: 'fixture', role: 'OPS', fullName: 'OPS fixture' }).returning();
      const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
      const [route] = await tx.insert(s.routes).values({ name: key }).returning();
      const [cargo] = await tx.insert(s.cargoTypes).values({ name: key }).returning();
      const trip = await insertTripComposite(tx, { tripCode: key, customerId: customer.id, routeId: route.id,
        cargoTypeId: cargo.id, departureDate: '2026-09-17', status: 'COMPLETED', carrierType: 'OWN' });
      const [expense] = await tx.insert(s.tripExpenses).values({ tripId: trip.id, expenseType: 'OTHER',
        buyAmount: '9000', sellAmount: '500', forwarderId: user.id, approvalStatus: 'RECORDED',
        containerNumber: 'CONT-LIVE', invoiceNumber: 'INV-LIVE' }).returning();
      const [request] = await tx.insert(s.advanceRequests).values({ requesterId: user.id, amount: '1000000',
        status: 'RECORDED', reason: 'Original principal' }).returning();
      const [settlement] = await tx.insert(s.advanceSettlements).values({ code: `QA-${key.slice(0, 12)}`, forwarderId: user.id,
        totalExpenseAmount: '1000', refundAmount: '0', status: 'RECORDED' }).returning();
      await tx.insert(s.advanceSettlementRequests).values({ settlementId: settlement.id,
        advanceRequestId: request.id, allocatedAmount: '1000' });
      await tx.insert(s.settlementExpenses).values({ settlementId: settlement.id, tripExpenseId: expense.id,
        originalBuyAmount: '800', adjustedBuyAmount: '1000', submittedSellAmount: '500',
        originalSnapshot: { buyAmount: '800' },
        adjustedSnapshot: { buyAmount: '1000', containerNumber: 'CONT-SNAPSHOT', invoiceNumber: 'INV-SNAPSHOT' } });

      const detail = await getAdvanceSettlement(settlement.id, tx);
      assert.equal(detail?.linkedRequests[0].amount, '1000000', 'original advance principal remains inspectable');
      assert.equal(detail?.linkedRequests[0].allocatedAmount, '1000');
      const data = await buildSettlementExportData(settlement.id, tx);
      assert.ok(data);
      assert.equal(data.linkedRequests[0].amount, '1000');
      assert.equal(data.linkedExpenses[0].amount, '1000', 'cost snapshot, not sell amount or current native amount');
      assert.equal(data.linkedExpenses[0].containerNumber, 'CONT-SNAPSHOT');
      const html = await renderSettlementHtml(data);
      assert.ok(html.includes(formatVND(1_000, true)));
      assert.ok(!html.includes(formatVND(1_000_000, true)), 'do not print the whole advance as consumed');
      assert.match(html, /CONT-SNAPSHOT/);
      assert.match(html, /INV-SNAPSHOT/);

      const chunks: Buffer[] = [];
      await renderSettlementXlsx(data, new Writable({ write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk)); callback();
      } }));
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.concat(chunks)).buffer);
      const summary = new Map<string, unknown>();
      workbook.worksheets[0].eachRow(row => summary.set(String(row.getCell(1).value ?? ''), row.getCell(5).value));
      assert.equal(summary.get('Tổng tạm ứng đã sử dụng'), 1_000);
      assert.equal(summary.get('Tổng chi phí phát sinh'), 1_000);
      assert.equal(summary.get('Còn dư (phải hoàn lại)'), 0);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
