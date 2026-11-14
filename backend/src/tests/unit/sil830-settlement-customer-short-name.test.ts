/**
 * SIL-830 (id 959) — phiếu quyết toán đọc TÊN VIẾT TẮT, không tên pháp lý.
 *
 * QA 14/11 (staging build 06af2306, ops hoangnh + kế toán hoapt): mọi nhóm
 * lô trên phiếu quyết toán hiện "CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH"
 * (tên pháp lý) ở cả danh sách phiếu, chi tiết phiếu, và góc nhìn kế toán
 * (/advances → Chi phí Ops → Xem phiếu) — trong khi danh mục khách hàng đã
 * có tên viết tắt "Long Minh" / mã "LONGMINH". Đặc tả Task 3.1 + KB Ch.2
 * yêu cầu phiếu đọc tên VIẾT TẮT.
 *
 * Luật: mỗi projection khách hàng của miền phiếu quyết toán đi qua
 * `operationalName(shortName, name)` — cùng coalesce law mà mọi grid
 * projection khác đọc (tên ngắn khi có, fallback tên đầy đủ). Sáu site:
 * enrichSettlementWithRequests (chi tiết phiếu tay), listAdvanceSettlements
 * (snapshot danh sách), listOpsSettlementsForForwarderPaginated +
 * getAdvanceSettlementFromOps (phiếu quyết toán Ops), getOpsSettlementDetail
 * (sheet "Xem phiếu" + XLSX export của kế toán), và bản in/xem trước export.
 *
 * Unit pins only (no app boot, no DB — 2026-10-19 owner ruling): source
 * scans that every settlement-surface projection is wired to the one law.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  fs.readFileSync(path.resolve(process.cwd(), `src/services/${file}`), 'utf8');

const advanceSharedSource = read('advance-shared.service.ts');
const advanceSettlementSource = read('advance-settlement.service.ts');
const opsSettlementsSource = read('ops-settlements.service.ts');
const settlementExportSource = read('settlement-export.service.ts');

const SHORT_NAME_PROJECTION = 'customerName: operationalName(s.customers.shortName, s.customers.name)';
const LEGAL_NAME_PROJECTION = 'customerName: s.customers.name';

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

describe('SIL-830 — settlement surfaces read the operational (short) customer name', () => {
  it('the manual phiếu rows (list groups + detail + KHÁCH HÀNG column) project the short name', () => {
    const detailReader = slice(
      advanceSharedSource,
      'export async function enrichSettlementWithRequests',
      '/** Clamp shared by both advance list paginators. */',
    );
    assert.ok(detailReader.includes(SHORT_NAME_PROJECTION),
      'linkedExpenses.customerName feeds identityTitle + KHÁCH HÀNG — it must read operationalName');
  });

  it('every advance-settlement reader projects the short name — list snapshot, ops list, ops detail', () => {
    const listSnapshot = slice(
      advanceSettlementSource,
      'export async function listAdvanceSettlements(',
      'export function mapOpsStatusToSettlementStatus',
    );
    assert.ok(listSnapshot.includes(SHORT_NAME_PROJECTION),
      'the batched list snapshot feeds the danh sách phiếu groups');

    const opsList = slice(
      advanceSettlementSource,
      'async function listOpsSettlementsForForwarderPaginated',
      'async function getAdvanceSettlementFromOps',
    );
    assert.ok(opsList.includes(SHORT_NAME_PROJECTION),
      'ops-derived settlement rows in the forwarder list read the same law');

    const opsDetail = slice(
      advanceSettlementSource,
      'async function getAdvanceSettlementFromOps',
      'export async function listAdvanceSettlementsPaginated',
    );
    assert.ok(opsDetail.includes(SHORT_NAME_PROJECTION),
      'the ops settlement detail rows feed the chi tiết phiếu view');
  });

  it('the kế toán "Xem phiếu" sheet + XLSX export derive from short-name entries', () => {
    const detailReader = slice(
      opsSettlementsSource,
      'export async function getOpsSettlementDetail',
      'async function assertOpsSettlementEvidence',
    );
    assert.ok(detailReader.includes(SHORT_NAME_PROJECTION),
      'groupOpsExpensesForSettlement builds identityTitle from these entries');
  });

  it('the print/preview export carries the same short-name label as the screen', () => {
    const preview = slice(
      settlementExportSource,
      'async function buildPreviewSettlementData',
      'export async function previewSettlementHtml',
    );
    assert.ok(preview.includes(SHORT_NAME_PROJECTION),
      'the exported phiếu must not disagree with the on-screen phiếu');
  });

  it('no settlement surface still projects the raw legal name', () => {
    for (const [file, source] of [
      ['advance-shared.service.ts', advanceSharedSource],
      ['advance-settlement.service.ts', advanceSettlementSource],
      ['ops-settlements.service.ts', opsSettlementsSource],
      ['settlement-export.service.ts', settlementExportSource],
    ] as const) {
      assert.equal(source.split(LEGAL_NAME_PROJECTION).length - 1, 0,
        `${file} must not feed any surface the raw s.customers.name`);
    }
    assert.equal(advanceSettlementSource.split(SHORT_NAME_PROJECTION).length - 1, 3,
      'all three advance-settlement projections converted');
  });
});
