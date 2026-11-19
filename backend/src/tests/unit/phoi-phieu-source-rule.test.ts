// Ticket 18/11 Task 3.1/3.2 — nguồn rule + composed Ghi chú pins for the phơi
// phiếu board. Rule statement (ticket, verbatim intent): bảng Kiểm soát phơi
// phiếu chỉ nhận (1) Kế toán phơi phiếu tự điền, (2) chi phí trucking Xe nhà
// (tiền đường, nâng/hạ/PS), (3) Xe ngoài/Vendor nâng/hạ/PS en route. Lô do
// Điều vận nhập (created_by → users.role = DISPATCHER, 'sản lượng vận tải
// ngoài'): Ops khai nâng/hạ thì hiện số tiền trên bảng. Lô khách Silver Sea
// ký trực tiếp: chi phí nâng/hạ Ops khai đẩy sang bảng Ghép bộ Debit — RỜI
// bảng này VÀ khỏi consolidated phiếu (phiếu đọc cùng bộ nguồn ô bảng hiển
// thị: preview = contents).
//
// Unit source pins only, no app boot, no DB — 2026-10-19 owner ruling,
// source-scan contract style (same as phoi-phieu-chiho-all-kinds.test.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/services/phoi-phieu-control.service.ts'),
  'utf8',
);

function fnBody(name: string): string {
  const match = source.match(new RegExp(`(export )?(async )?function ${name}\\([\\s\\S]*?\\n}`));
  assert.notEqual(match?.[0], undefined, `${name} must exist`);
  return match?.[0] ?? '';
}

test('isDispatchIntakeLot is the documented exported predicate: DISPATCHER = điều vận nhập', () => {
  const predicate = fnBody('isDispatchIntakeLot');
  assert.match(predicate, /creatorRole === 'DISPATCHER'/,
    'the intake axis is the CREATOR role, read per lot — nothing else');
  const doc = source.slice(source.indexOf('/**\n * Ticket 18/11 Task 3.1 — trục nguồn'), source.indexOf('export function isDispatchIntakeLot'));
  assert.ok(doc.includes('shipments.created_by'), 'the doc names the created_by → users.role join');
  assert.ok(doc.includes('Ghép bộ Debit'), 'the doc names the flow the excluded money belongs to');
  assert.ok(doc.includes('NULL'), 'a legacy NULL creator reads as direct-signed (excluded)');
});

test('the board OPS sources carry the structural category and the rule drops direct-signed nâng/hạ', () => {
  // The category rides the expense TYPE join — never a fee-name match.
  assert.match(source, /category: s\.forwarderExpenseTypes\.category,\s*\n\s*\}\)\s*\n\s*\.from\(s\.expenseAccountingSources\)\s*\n\s*\.innerJoin\(s\.opsExpenseEntries/,
    'the board OPS projection joins the expense type for its structural category');
  const boardFilter = source.match(/const opsSources = opsSourceRows\.filter\(([^;]+)\);/)?.[1] ?? '';
  assert.match(boardFilter, /!isExcludedOpsNangHaSource\(source, intakeRoleByShipment\)/,
    'the board row-build applies the lockstep predicate');
  // PS khác stays: only LIFT/DROP are the excluded family.
  const family = fnBody('isOpsNangHaCategory');
  assert.match(family, /category === 'LIFT' \|\| category === 'DROP'/);
  assert.doesNotMatch(family, /'khac'|'OTHER'/, 'PS khác never leaves the board');
});

test('the creator-role lookup is batched: one shipments⋈users read per window, executor injected', () => {
  const lookup = fnBody('phoiLotIntakeRoles');
  assert.match(lookup, /exec: Executor/, 'the voucher transaction shares the same rule read');
  assert.match(lookup, /\.leftJoin\(s\.users, eq\(s\.users\.id, s\.shipments\.createdBy\)\)/);
  assert.match(lookup, /\[\.\.\.new Set\(shipmentIds\)\]/, 'distinct ids before the inArray — never a per-row lookup');
  assert.match(source, /phoiLotIntakeRoles\(db, shipmentIds\)/, 'the board reads roles batched');
  assert.match(source, /phoiLotIntakeRoles\(tx, shipmentIds\)/, 'the phiếu reads roles inside its transaction');
});

test('the consolidated phiếu applies the SAME predicate — board cell and phiếu cannot drift', () => {
  const voucher = source.slice(
    source.indexOf('export async function createPhoiPhieuVoucher'),
    source.indexOf('export async function listPhoiPhieuStk'),
  );
  assert.match(voucher, /\.filter\(\(source\) => !isExcludedOpsNangHaSource\(source, intakeRoleByShipment\)\)/,
    'the phiếu filters its OPS sources through the lockstep predicate');
  assert.match(voucher, /category: s\.forwarderExpenseTypes\.category/, 'the phiếu reads the category too');
});

test('TRIP and DRIVER sources never pass the rule — the admitted sources stay untouched', () => {
  const tripQuery = source.match(/const tripSources = await db\.select\(\{[\s\S]*?\.where\(and\([^;]+;/)?.[0] ?? '';
  assert.ok(tripQuery.includes("eq(s.expenseAccountingSources.sourceKind, 'TRIP')"), 'sanity: TRIP query located');
  assert.ok(!tripQuery.includes('isExcludedOpsNangHaSource'), 'TRIP (chi phí chuyến / tiền đường) is never rule-filtered');
  const driverQuery = source.match(/const driverSources = await db\.select\(\{[\s\S]*?const driverByTrip/)?.[0] ?? '';
  assert.ok(driverQuery.includes("eq(s.expenseAccountingSources.sourceKind, 'DRIVER')"), 'sanity: DRIVER query located');
  assert.ok(!driverQuery.includes('isExcludedOpsNangHaSource'), 'DRIVER (lái xe khai) is never rule-filtered');
});

test('the board row and the party lot both carry the composed Ghi chú (CUS trước, điều vận sau)', () => {
  const composer = fnBody('phoiComposedNote');
  assert.match(composer, /\[customerNotes, operationalNotes\]/, 'CUS customerNotes composes FIRST');
  assert.match(composer, /join\('; '\)/);
  assert.match(source, /ghiChu: string \| null;\s*\n\s*confirmable: boolean/, 'PhoiPhieuRow carries the composed note');
  assert.match(source, /ghiChu: phoiComposedNote\(row\.customerNote, row\.operationalNotes\)/,
    'the board row builds it from the same two note fields');
  assert.match(source, /ghiChu: string \| null;\s*\n\s*entries: Array<\{ sourceId: number; expectedVersion: number; amount: number; bucket/,
    'PhoiPhieuPartyLot carries the composed note for the drawer');
  assert.match(source, /lot\.ghiChu = phoiComposedNote\(identity\.customerNotes, identity\.operationalNotes\)/,
    'the drill-down composes from the same identity read');
});
