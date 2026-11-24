// SIL-970 (KB K10.37 §10.6.9/§10.7.4 — Chốt theo đợt): "Khi lô đã đủ chi
// phí, Chứng từ bấm [Khóa lô] và [Chọn Debit] như Kế toán." [Chốt đợt] IS the
// settlement-round POST, so its guard must admit Role.CUS alongside the
// office trio — the SAME set the settlement-round GET rides (CUS reads its
// đợt list to pick Lần · Tháng · Năm). OFFICE_ROLES on the POST 403s Chứng
// từ with "Không có quyền truy cập" while Kế toán closes the same lot — the
// SIL-970 repro. Route-guard role wiring has no db-free runtime seam (app
// boot is banned in BE unit tests, owner ruling 2026-10-19), so this rides
// the established source-scan pattern (see ops-expense-declare-roles.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const accountingDebitRoutesSource = readFileSync(join(here, '../../routes/accounting-debit.ts'), 'utf8');

test('SIL-970: the settlement-round guard set is the office trio + CUS', () => {
  assert.match(
    accountingDebitRoutesSource,
    /const SETTLEMENT_ROUND_ROLES = requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT, Role\.CUS\)/,
    'SETTLEMENT_ROUND_ROLES must name Role.CUS — Chứng từ chốt đợt như Kế toán',
  );
});

test('SIL-970: [Chốt đợt] (POST /debit-board/settlement-rounds) rides that guard, not OFFICE_ROLES', () => {
  assert.match(
    accountingDebitRoutesSource,
    /accountingDebitRoutes\.post\(\s*'\/debit-board\/settlement-rounds',[^\n]*?SETTLEMENT_ROUND_ROLES/,
    'POST /debit-board/settlement-rounds must admit CUS — OFFICE_ROLES is the 403 im lặng repro',
  );
});

test('SIL-970: the settlement-round list read shares the same guard set', () => {
  assert.match(
    accountingDebitRoutesSource,
    /accountingDebitRoutes\.get\(\s*'\/debit-board\/settlement-rounds',[^\n]*?SETTLEMENT_ROUND_ROLES/,
    'GET /debit-board/settlement-rounds must keep riding SETTLEMENT_ROUND_ROLES',
  );
});
