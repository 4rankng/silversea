/**
 * QA 2026-11-04 (e2e flow walk) — a lot exported to Debit Note keeps its cost
 * lock, and assertShipmentCostUnlocked used to tell every editor "Cần ADMIN
 * mở khóa (kèm lý do) để chỉnh sửa chi phí" — but unlockShipmentCost refuses
 * exactly that while the lot sits in an issued Debit Note (409 "Lô đã nằm
 * trong Debit Note #… — xử lý chứng từ trước khi mở khóa lô"). The guidance
 * pointed at an impossible action. The assert now consults the same
 * debitNoteLots claim first and names the document; the plain locked message
 * stays for lots no document holds. Pins the wiring + both messages.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');

const assertBody = svc.slice(
  svc.indexOf('export async function assertShipmentCostUnlocked'),
  svc.indexOf('/** Audit 2026-11-04 §2.3'),
);

test('assertShipmentCostUnlocked checks the debitNoteLots claim before the generic message', () => {
  assert.match(assertBody, /from\(s\.debitNoteLots\)/);
  assert.match(assertBody, /eq\(s\.debitNoteLots\.shipmentId, shipmentId\)/);
  assert.match(assertBody, /isNull\(s\.debitNoteLots\.releasedAt\)/);
  // Early return when no active lock — the claim probe must stay behind it.
  assert.match(assertBody, /if \(!active\) return;/);
});

test('a claimed lot gets the Debit-Note guidance naming the document', () => {
  assert.match(assertBody, /`Lô đã nằm trong Debit Note #\$\{claim\.documentId\} — không sửa được chi phí; xử lý chứng từ debit trước khi mở khóa lô\.`/);
});

test('the plain cost-locked message names the three-role unlock channel and the unlock refusal stays unchanged', () => {
  assert.match(svc, /export const SHIPMENT_COST_LOCKED_MESSAGE = 'Lô hàng đã khóa chi phí\. Cần Quản trị, Giám đốc hoặc Kế toán mở khóa \(kèm lý do\) để chỉnh sửa chi phí\.';/);
  assert.match(svc, /`Lô đã nằm trong Debit Note #\$\{claim\.documentId\} — xử lý chứng từ trước khi mở khóa lô\.`/);
});
