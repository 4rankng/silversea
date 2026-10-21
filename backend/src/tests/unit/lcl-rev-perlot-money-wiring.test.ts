import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// LCL-07 — boss ruling 21/10 wiring pins (source-scan, unit-only tree: no db
// connection, no app boot). Asserts the MONEY LAW the services carry, not a
// re-pin of the old 100%/0₫ principal law:
//   REV (thu khách) = per-lot: mỗi lô tự tính đơn giá (bảng giá Tuyến×KH ×
//     loại xe) của CHÍNH lô đó — không gộp 100% vào Lô 1, không 0₫ thành
//     viên; tách nhóm KHÔNG chuyển tiền.
//   COST (trả ĐV) = 1 dòng/chuyến: Lô 1 giữ 100% cước trả, thành viên 0₫.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const svc = read('../../services/lcl-grouping.service.ts');

test('REV merge prices each lot independently (per boss 21/10)', () => {
  // The merge loop calls resolveCustomerVehicleClassPrice per row (not just on
  // the principal), and stamps every lot from its own lane price.
  assert.match(svc, /mergeLclRevGroup[\s\S]*?for \(const \[index, row\] of ordered\.entries\(\)\)/);
  assert.match(svc, /resolveCustomerVehicleClassPrice\(\{\s*customerId: row\.customerId,\s*routeId: row\.routeId,/);
  // No 0₫ member zeroing left in the REV merge path.
  assert.doesNotMatch(
    svc.slice(svc.indexOf('export async function mergeLclRevGroup'), svc.indexOf('export async function setLclLotRevClass')),
    /revenue: '0'/,
  );
});

test('REV tách nhóm keeps per-lot money (no transfer between lots)', () => {
  // keepRevPerLotMoney is the only REV un-merge/dissolve money path and it
  // must not write revenue.
  const fn = svc.slice(svc.indexOf('async function keepRevPerLotMoney'), svc.indexOf('function auditGroupChange'));
  assert.doesNotMatch(fn, /revenue:/);
  assert.match(svc, /await keepRevPerLotMoney\(tx, member,/);            // dissolve
  assert.match(svc, /await keepRevPerLotMoney\(tx, leaver,/);            // single-lot + principal-exit
});

test('COST stays 1 dòng/chuyến (Lô 1 = 100% cước trả, members 0₫)', () => {
  const assign = svc.slice(
    svc.indexOf('export async function assignLclCostGroup'),
    svc.indexOf('export async function mergeLclRevGroup'),
  );
  assert.match(assign, /applyPrincipalCostFreight\(tx,/);
  assert.match(assign, /externalFreightCost: '0'/);
  assert.doesNotMatch(assign, /allocateGroupFreight/);                  // no per-lot cost split
});
