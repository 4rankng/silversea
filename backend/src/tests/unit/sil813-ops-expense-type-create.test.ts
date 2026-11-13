// SIL-813 (id 941) — popup Khai chi phí: Ops gõ tên loại phí MỚI chưa có
// trong danh mục; khi Lưu, hệ thống ghi loại phí mới vào danh mục của nhóm
// tương ứng (Phí có hóa đơn / Phí không hóa đơn) để các lần sau có sẵn.
//
// Per the BE unit-only ruling (da4d2f0b): the code fold is a pure function
// (tested outright), the insert/dedupe wiring rides the source-scan
// convention (precedent: sil751, ops-expense-declare-roles).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseTypeCodeFromName } from '../../services/ops-expenses.service';

const routes = readFileSync(path.resolve(process.cwd(), 'src/routes/ops.ts'), 'utf8');
const service = readFileSync(path.resolve(process.cwd(), 'src/services/ops-expenses.service.ts'), 'utf8');
const create = service.slice(service.indexOf('export async function createOpsExpenseType'));

test('SIL-813 — the code fold turns a Vietnamese fee name into an ASCII snake code', () => {
  assert.equal(expenseTypeCodeFromName('Phí nâng container'), 'PHI_NANG_CONTAINER');
  assert.equal(expenseTypeCodeFromName('Phí rút vỏ'), 'PHI_RUT_VO');
  assert.equal(expenseTypeCodeFromName('Cẩu  dẫn   hướng'), 'CAU_DAN_HUONG');
  assert.equal(expenseTypeCodeFromName('!!!'), 'LOAI_PHI', 'symbol-only names fall back');
  assert.equal(expenseTypeCodeFromName('A'.repeat(80)), 'A'.repeat(50), 'capped at the 50-char column');
  assert.equal(expenseTypeCodeFromName('Phí ____'), 'PHI', 'trailing separators strip');
});

test('SIL-813 — POST /ops/expense-types is declarer-gated and material-declared', () => {
  assert.match(
    routes,
    /router\.post\('\/expense-types', declareMaterialWrite\('ops\.expense-types\.create'[^)]*\), EXPENSE_DECLARERS/,
    'OPS + CUS may add a missing fee type, audited as a material write',
  );
  assert.match(routes, /expenseTypeCreateSchema = z\.object\(\{\s*name: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(100\),\s*requiresInvoice: z\.boolean\(\)/);
});

test('SIL-813 — the write dedupes by name and persists the group flag', () => {
  assert.match(
    create,
    /lower\(\$\{s\.forwarderExpenseTypes\.name\}\) = \$\{name\.toLowerCase\(\)\}/,
    'a case-variant replay returns the live row instead of duplicating the catalog entry',
  );
  assert.match(create, /return \{ item: found, created: false \}/);
  assert.match(
    create,
    /requiresInvoice: input\.requiresInvoice/,
    'the flag follows the TAB: invoice rows file under Phí có hóa đơn, the rest under Phí không hóa đơn',
  );
  assert.match(create, /status: 'ACTIVE'/, 'the new type must appear in the declarable catalog at once');
  assert.match(
    create,
    /DRIVER_EXPENSE_TYPE_CODES\[code\]/,
    'a generated code must never collide with a DRIVER bucket — it would vanish from the Ops list',
  );
});
