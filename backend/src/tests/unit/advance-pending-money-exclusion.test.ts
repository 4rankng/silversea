// SIL-808 (UAT 12/11) — "kiểm chung + sửa nếu lệch": phiếu tạm ứng MỚI của
// Ops phải nằm ở 'Chờ duyệt' (PENDING) và KHÔNG cộng quỹ — không đụng Quỹ
// tiền mặt công ty, không cộng quỹ cá nhân Ops — cho đến khi kế toán bấm
// [Xác nhận giải ngân tạm ứng] (PENDING → RECORDED + fundAdvance trong cùng
// transaction) hoặc [Từ chối] (PENDING → VOIDED, không tiền). Tất cả các cổ
// động computed quỹ phải lọc status='RECORDED' — PENDING không bao giờ được
// đếm là tiền (unit source pins, no db — 2026-10-19 owner ruling).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const read = (p: string): string => readFileSync(path.resolve(process.cwd(), p), 'utf8');

test('every money authority reads RECORDED advances only — PENDING is not money', () => {
  // The signed-wallet authority the report/wallet read from.
  const shared = read('src/services/advance-shared.service.ts');
  assert.match(shared, /export async function getSignedOutstandingAdvanceBalances[\s\S]*?eq\(s\.advanceRequests\.status, 'RECORDED'\)/,
    'outstanding balances exclude PENDING phiếu');
  // The Ops wallet summary (Số dư hiện tại / Đã ứng).
  const wallet = read('src/services/ops-wallet.service.ts');
  assert.match(wallet, /eq\(s\.advanceRequests\.requesterId, userId\), eq\(s\.advanceRequests\.status, 'RECORDED'\)/,
    'wallet totalAdvance sums RECORDED phiếu only');
  // The reconciliation report's held column (bảng Quỹ cá nhân).
  const report = read('src/services/ops-reconciliation-report.service.ts');
  assert.match(report, /const heldRows = await db\.select\(\{[\s\S]*?eq\(s\.advanceRequests\.status, 'RECORDED'\)/,
    'report held ĐÃ ỨNG excludes PENDING phiếu');
});

test('the Ops create route records PENDING — money moves only at the kế toán action', () => {
  const opsRoute = read('src/routes/ops.ts');
  assert.match(opsRoute, /createAdvanceRequest\(user\.userId, parsed, tx, \{ pending: true \}\)/,
    'Ops "+ gửi yêu cầu tạm ứng" writes PENDING');
  const funding = read('src/services/advance-funding.service.ts');
  assert.match(funding, /status: 'RECORDED', approvedBy: actor\.userId, approvedAt: new Date\(\),[\s\S]*?const funding = await fundAdvance\(tx, actor/,
    '[Xác nhận giải ngân] flips PENDING → RECORDED and funds in the SAME transaction');
  assert.match(funding, /status: 'VOIDED', version: before\.version \+ 1, updatedAt: new Date\(\),[\s\S]*?ADVANCE_REQUEST_REJECTED/,
    '[Từ chối] voids without any funding call');
  assert.doesNotMatch(funding.slice(funding.indexOf('rejectAdvanceRequest')), /fundAdvance/,
    'the reject path never touches the treasury');
});
