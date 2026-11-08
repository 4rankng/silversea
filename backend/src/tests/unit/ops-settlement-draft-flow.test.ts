/**
 * QA 2026-11-04 (e2e flow walk) — the Ops settlement state machine was
 * collapsed: createOpsSettlement inserted status 'RECORDED' directly while
 * finalizeOpsSettlement only accepts DRAFT|PENDING and reopenOpsSettlementDraft
 * only releases DRAFT|PENDING. Both endpoints (and the OpsSettlementsPanel
 * "Hoàn tất phiếu" / "Mở khoản chi để bổ sung" buttons, which render for
 * DRAFT|PENDING only) were unreachable — every created phiếu skipped its own
 * draft stage. These pins hold the intended machine in place:
 * create → DRAFT, finalize → RECORDED, reopen → VOIDED (expenses released).
 * Also pins the sibling audit finding: editing an expense frozen in a
 * settlement is a 409 state conflict (was 400, mismatching the sibling
 * "vừa thay đổi trạng thái" guards).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const service = read('../../services/ops-settlements.service.ts');
const expenses = read('../../services/ops-expenses.service.ts');
const panel = read('../../../../frontend/src/features/ops/OpsSettlementsPanel.tsx');

const slice = (source: string, from: string, to: string) => source.slice(
  source.indexOf(from),
  source.indexOf(to, source.indexOf(from)),
);

test('createOpsSettlement inserts DRAFT — the only status finalize/reopen accept', () => {
  const create = slice(service, 'export async function createOpsSettlement', 'export async function listOpsSettlements');
  assert.match(create, /status: 'DRAFT',/);
  assert.doesNotMatch(create, /status: 'RECORDED',/);
});

test('finalizeOpsSettlement: DRAFT|PENDING → RECORDED stays the single exit to RECORDED', () => {
  const finalize = slice(service, 'export async function finalizeOpsSettlement', '/** Release a historical incomplete batch');
  assert.match(finalize, /settlement\.status !== 'DRAFT' && settlement\.status !== 'PENDING'/);
  assert.match(finalize, /set\(\{ status: 'RECORDED', totalAmount: total\.toString\(\), updatedAt: new Date\(\) \}\)/);
});

test('reopenOpsSettlementDraft: DRAFT|PENDING → VOIDED releases the frozen expenses', () => {
  const reopen = service.slice(service.indexOf('export async function reopenOpsSettlementDraft'));
  assert.match(reopen, /!\['DRAFT', 'PENDING'\]\.includes\(settlement\.status\)/);
  assert.match(reopen, /set\(\{ opsSettlementId: null, updatedAt: new Date\(\) \}\)/);
  // SIL-751 — the released entries leave the phiếu with zero lines, so the
  // VOIDED header must read 0 (the audit payload keeps the original total).
  assert.match(reopen, /set\(\{ status: 'VOIDED', totalAmount: '0', updatedAt: new Date\(\) \}\)/);
});

test('ops-expenses: editing an expense frozen in a settlement refuses with 409', () => {
  const guard = slice(expenses, 'async function getEditableExpense', 'async function attachPhotoRows');
  assert.match(guard, /ApiError\(409, 'Khoản chi đã nằm trong phiếu quyết toán, không thể chỉnh sửa\.'\)/);
  assert.doesNotMatch(guard, /ApiError\(400, 'Khoản chi đã nằm trong phiếu quyết toán/);
});

test('OpsSettlementsPanel renders finalize/reopen for DRAFT — the stage create must produce', () => {
  assert.match(panel, /DRAFT: \{ label: 'Bản nháp cần hoàn tất'/);
  assert.match(panel, /item\.status === 'DRAFT' \|\| item\.status === 'PENDING'/);
});
