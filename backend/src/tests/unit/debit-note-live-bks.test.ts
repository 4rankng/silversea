// SIL-172 (FB-141 đuôi): Debit Note export phải in BKS báo khách / loại xe theo
// GIÁ TRỊ HIỆN TẠI của lô — không theo snapshot đóng băng trên dòng ADHOC lúc
// phát hành. Pure resolver ở billing-export-live-identity.ts (db-free) +
// source-scan chốt wiring vào enrich (backend unit = không import db).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLiveLotIdentityToFrozenLine,
  liveReportedPlate,
  resolveDebitNoteLotIdentity,
  type DebitNoteLotBillingIdentity,
  type DebitNoteLotClaims,
} from '../../services/billing-export-live-identity';
import type { BillingDocumentLine } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(here, '../../services/billing-export-shared.service.ts'), 'utf8');

// QA repro lô R41B3-LCL01: dòng ADHOC đóng băng mang renderData đúng dạng
// buildFrozenShipmentDebitLines stamp (FB-094 §II.4) — tái tạo shape ở đây để
// test không phải import chuỗi service dính db.
function frozenLine(documentId: number, description: string): BillingDocumentLine {
  return {
    sourceType: 'ADHOC', sourceId: null, documentId,
    lineType: 'FREIGHT', typeLabel: 'Cước vận tải (auto)', unit: 'lần',
    description,
    renderData: { truckPlate: '88Q-99999', vehicleType: 'Xe tải 5 tấn' },
    baseAmount: 1500000, netAmount: 1500000, taxAmount: 0, grossAmount: 1500000,
    sortOrder: 0,
  } as BillingDocumentLine;
}

const LCL_LOT = (overrides: Partial<DebitNoteLotBillingIdentity> = {}): DebitNoteLotBillingIdentity => ({
  shipmentId: 193,
  lotCode: 'R41B3-LCL01',
  billingTruckNo: null,
  actualTruckNo: null,
  cargoMode: 'LCL',
  vehicleType: 'Xe tải 5 tấn',
  ...overrides,
});

function claimsOf(identities: DebitNoteLotBillingIdentity[]): DebitNoteLotClaims {
  const lots = new Map<string, DebitNoteLotBillingIdentity>();
  for (const identity of identities) {
    lots.set(identity.lotCode, identity);
    lots.set(String(identity.shipmentId), identity);
  }
  return new Map([[77, lots]]);
}

const SINGLE_LOT_DESCRIPTION = 'Cước vận tải (auto) — lô R41B3-LCL01 (chốt từ snapshot khóa lô)';

// ─── SIL172-R2: xóa BKS ảo → file mới KHÔNG chứa 88Q-99999 ──────────────────

test('đã xóa BKS báo khách (lô LCL không BKS thực): plate render về TRỐNG, không giữ 88Q-99999', () => {
  const line = frozenLine(77, SINGLE_LOT_DESCRIPTION);
  const out = applyLiveLotIdentityToFrozenLine(line, claimsOf([LCL_LOT()]));
  assert.equal(out.renderData?.truckPlate, null);
  assert.ok(!JSON.stringify(out).includes('88Q-99999'));
});

// ─── SIL172-R3: xóa nhưng có BKS thực (LCL) → fallback BKS thực ─────────────

test('BKS ảo đã xóa, lô LCL có BKS thực → in BKS thực (effectiveBillingPlate fallback)', () => {
  const out = applyLiveLotIdentityToFrozenLine(
    frozenLine(77, SINGLE_LOT_DESCRIPTION),
    claimsOf([LCL_LOT({ actualTruckNo: '29H-123.45' })]),
  );
  assert.equal(out.renderData?.truckPlate, '29H-123.45');
});

// ─── SIL172-R4: đổi BKS ảo → in giá trị MỚI (đọc hiện tại) ───────────────────

test('đổi BKS báo khách sau phát hành → plate = giá trị mới, không phải snapshot cũ', () => {
  const out = applyLiveLotIdentityToFrozenLine(
    frozenLine(77, SINGLE_LOT_DESCRIPTION),
    claimsOf([LCL_LOT({ billingTruckNo: '88Q-11111' })]),
  );
  assert.equal(out.renderData?.truckPlate, '88Q-11111');
});

test('non-LCL xóa BKS ảo → trống (GAP-3: không bao giờ lộ BKS thực)', () => {
  const out = applyLiveLotIdentityToFrozenLine(
    frozenLine(77, SINGLE_LOT_DESCRIPTION),
    claimsOf([LCL_LOT({ cargoMode: 'FCL', actualTruckNo: '29H-123.45' })]),
  );
  assert.equal(out.renderData?.truckPlate, null);
});

// ─── Tiền không đổi; loại xe live ────────────────────────────────────────────

test('chỉ plate/vehicleType override — tiền và các field khác giữ nguyên', () => {
  const line = frozenLine(77, SINGLE_LOT_DESCRIPTION);
  const out = applyLiveLotIdentityToFrozenLine(
    line,
    claimsOf([LCL_LOT({ billingTruckNo: '88Q-22222', vehicleType: 'Xe tải 10 tấn' })]),
  );
  assert.equal(out.baseAmount, line.baseAmount);
  assert.equal(out.grossAmount, line.grossAmount);
  assert.equal(out.description, line.description);
  assert.equal(out.renderData?.vehicleType, 'Xe tải 10 tấn');
});

// ─── Gộp kỳ: mỗi dòng theo đúng lô của nó (per-line current value) ──────────

test('GBN gộp 2 lô: dòng nào theo lô đó, kể cả 2 lô đổi BKS khác nhau', () => {
  const lotA = LCL_LOT({ lotCode: 'R41B2-FCL01', shipmentId: 192, cargoMode: 'FCL', billingTruckNo: '88Q-AAAAA' });
  const lotB = LCL_LOT({ billingTruckNo: null, actualTruckNo: '29H-777.77' });
  const map = claimsOf([lotA, lotB]);
  const lineA = applyLiveLotIdentityToFrozenLine(
    frozenLine(77, 'Cước vận tải (auto) — lô R41B2-FCL01 (chốt từ snapshot khóa lô)'), map);
  const lineB = applyLiveLotIdentityToFrozenLine(frozenLine(77, SINGLE_LOT_DESCRIPTION), map);
  assert.equal(lineA.renderData?.truckPlate, '88Q-AAAAA');
  assert.equal(lineB.renderData?.truckPlate, '29H-777.77');
});

test('claim không resolve được (multi-lot, description không mã lô) → giữ nguyên, không đoán', () => {
  const line = frozenLine(77, 'Cước vận tải (auto)');
  const map = claimsOf([LCL_LOT({ shipmentId: 1, lotCode: 'A' }), LCL_LOT({ shipmentId: 2, lotCode: 'B' })]);
  const out = applyLiveLotIdentityToFrozenLine(line, map);
  assert.equal(out.renderData?.truckPlate, '88Q-99999');
  assert.equal(resolveDebitNoteLotIdentity(line, map), null);
});

// ─── SIL172-R5: legacy (pre-FB-094) giữ luật gốc ─────────────────────────────

test('dòng KHÔNG renderData (legacy pre-FB-094) không bị pure-resolver đụng', () => {
  const legacy = { ...frozenLine(77, SINGLE_LOT_DESCRIPTION), renderData: null } as BillingDocumentLine;
  const out = applyLiveLotIdentityToFrozenLine(legacy, claimsOf([LCL_LOT({ actualTruckNo: '29H-999.99' })]));
  assert.equal(out.renderData, null);
  assert.equal(liveReportedPlate(LCL_LOT({ billingTruckNo: '  ', actualTruckNo: null })), null);
});

// ─── Wiring: enrich đọc LIVE, legacy luật billing-or-nothing ─────────────────

test('source-scan: loader lấy identity live (actualTruckNo+cargoMode) cho MỌI dòng ADHOC có claim', () => {
  // Không còn filter `!line.renderData` — frozen lines cũng được re-resolve.
  assert.match(shared, /sourceType === 'ADHOC' && line\.documentId != null/);
  assert.doesNotMatch(shared, /ADHOC' && !line\.renderData/);
  assert.match(shared, /actualTruckNo: s\.shipments\.actualTruckNo/);
  assert.match(shared, /cargoMode: s\.shipments\.cargoMode/);
});

test('source-scan: legacy path giữ luật billing-plate-or-nothing (không áp fallback retroactively — Review M2)', () => {
  const legacyFn = shared.slice(
    shared.indexOf('function legacyFrozenRenderData'),
    shared.indexOf('export async function enrichLinesForDebitNoteRender'),
  );
  assert.match(legacyFn, /truckPlate: identity\.billingTruckNo\?\.trim\(\) \|\| null/);
  assert.doesNotMatch(legacyFn, /effectiveBillingPlate/);
});

test('source-scan: cả 2 nhánh renderData đều chạy live re-stamp trước khi render', () => {
  const count = (shared.match(/applyLiveLotIdentityToFrozenLine\(/g) ?? []).length;
  // 1 nhánh early-return (không trip/expense) + 1 nhánh map chính.
  assert.ok(count >= 2, `expected >= 2 call sites, got ${count}`);
});
