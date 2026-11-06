// SIL-693 — the Debit Note line builder must never silently issue a note that
// omits freight: a NEW-format freeze whose freightAuto is explicitly unset
// while the recorded pricing basis says the engine SKIPPED pricing for lack of
// grounds (NO_RATE_KEY on an LCL lot dispatched without a rate key — staging
// lot 832 / SHP-2611-00338, note id 14 billed 150.000₫ instead of freight
// 3.800.000₫) is refused with the designed remedy. AD_HOC lots (their
// customer-reported freight bills through the phát-sinh cells by design) and
// legacy snapshots (no basis key) keep their frozen law byte-for-byte.
// Db-free unit (2026-10-19 owner ruling) — the builder lives on the
// billing-vat-math seam precisely so this file can pin the law as behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrozenShipmentDebitLines,
  readFrozenFreightPricingBasis,
} from '../../services/shipment-cost-lock-lines';

const UNPRICED_BASIS = { action: 'SKIP', reason: 'NO_RATE_KEY' } as const;

function snapshotWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { freightAuto: 3800000, receivableTotal: 3950000, chiHoTotal: 0, freightPricingBasis: { action: 'LOCK' }, ...overrides };
}

// ─── the guard: unpriced freeze + pricing skip ⇒ 409, never a freight-less note ─

test('SIL-693: freightAuto null + basis SKIP(NO_RATE_KEY) → 409 với remedy, không xuất note thiếu cước', () => {
  const snapshot = snapshotWith({ freightAuto: null, receivableTotal: 150000, freightPricingBasis: UNPRICED_BASIS });
  assert.throws(
    () => buildFrozenShipmentDebitLines(snapshot, 'SHP-2611-00338'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const message = 'message' in error ? String(error.message) : '';
      assert.match(message, /SHP-2611-00338/);
      assert.match(message, /NO_RATE_KEY/);
      assert.match(message, /Chi phí - Quyết toán/);
      return true;
    },
  );
});

test('SIL-693: mọi lý do SKIP thiếu căn cứ (trừ AD_HOC) đều chặn xuất', () => {
  for (const reason of ['NO_RATE_KEY', 'NO_ROUTE', 'NO_CUSTOMER', 'NO_TRANSPORT_DATE', 'MISSING_WEIGHT'] as const) {
    const snapshot = snapshotWith({ freightAuto: null, receivableTotal: 150000, freightPricingBasis: { action: 'SKIP', reason } });
    assert.throws(() => buildFrozenShipmentDebitLines(snapshot, 'R4B-CC-001'), /chưa được định giá/, `reason ${reason} phải chặn`);
  }
});

test('SIL-693: lô ad-hoc (SKIP AD_HOC — freight theo thiết kế nằm ở phát sinh thu khách) xuất như luật cũ', () => {
  const snapshot = snapshotWith({
    freightAuto: null,
    receivableTotal: 150000,
    freightPricingBasis: { action: 'SKIP', reason: 'AD_HOC' },
  });
  const lines = buildFrozenShipmentDebitLines(snapshot, 'R4B-ADHOC-01');
  // billedFreight = min(0, 150.000) = 0 → FREIGHT bị bỏ, SERVICE_FEE 150.000 — luật hiện có giữ nguyên.
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.lineType, 'SERVICE_FEE');
  assert.equal(lines[0]!.grossAmount, 150000);
});

test('SIL-693: snapshot legacy (không có freightPricingBasis — khóa trước SIL-693) giữ luật cũ, không chặn', () => {
  const legacy = { freightAuto: null, receivableTotal: 150000, chiHoTotal: 0 };
  const lines = buildFrozenShipmentDebitLines(legacy, 'R4B-LEGACY-01');
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.lineType, 'SERVICE_FEE');
  // Legacy freeze KHÔNG có key freightAuto (trước khi key tồn tại): ?? 0 luật cũ.
  const legacyNoKey = { receivableTotal: 150000, chiHoTotal: 0 } as Record<string, unknown>;
  assert.equal(buildFrozenShipmentDebitLines(legacyNoKey, 'R4B-LEGACY-02').length, 1);
});

// ─── the law unchanged: a priced freeze bills freight exactly as before ──

test('settlement có freight 3.800.000 → FREIGHT line đúng 3.800.000 + SERVICE_FEE phần phát sinh (luật min(freight, receivable))', () => {
  const snapshot = snapshotWith({
    freightAuto: 3800000,
    receivableTotal: 3950000,
    freightPricingBasis: { action: 'LOCK' },
  });
  const lines = buildFrozenShipmentDebitLines(snapshot, 'SHP-2611-00282');
  assert.equal(lines.length, 2);
  const freight = lines.find((line) => line.lineType === 'FREIGHT');
  const serviceFee = lines.find((line) => line.lineType === 'SERVICE_FEE');
  assert.ok(freight && serviceFee);
  assert.equal(freight.baseAmount, 3800000);
  assert.equal(freight.grossAmount, 3800000);
  assert.equal(serviceFee.grossAmount, 150000);
});

test('freightAuto 0 (giá 0 tính được — D02: zero tính toán là một giá trị) + receivable 0 → note rỗng như luật cũ', () => {
  const snapshot = snapshotWith({ freightAuto: 0, receivableTotal: 0, freightPricingBasis: { action: 'LOCK' } });
  const lines = buildFrozenShipmentDebitLines(snapshot, 'R4B-ZERO-01');
  assert.equal(lines.length, 0);
});

// ─── the frozen basis reader: malformed basis never blocks a note ──

test('readFrozenFreightPricingBasis: null/sai shape đọc absent; SKIP hợp lệ đọc đủ reason', () => {
  assert.equal(readFrozenFreightPricingBasis({ freightAuto: 3800000, freightPricingBasis: undefined }), null);
  assert.equal(readFrozenFreightPricingBasis(snapshotWith({ freightPricingBasis: null })), null);
  assert.equal(readFrozenFreightPricingBasis(snapshotWith({ freightPricingBasis: 'SKIP' })), null);
  assert.equal(readFrozenFreightPricingBasis(snapshotWith({ freightPricingBasis: { action: 'SKIP', reason: 'HACKED' } })), null);
  assert.deepEqual(readFrozenFreightPricingBasis(snapshotWith({ freightPricingBasis: UNPRICED_BASIS })), { action: 'SKIP', reason: 'NO_RATE_KEY' });
  assert.deepEqual(readFrozenFreightPricingBasis(snapshotWith({ freightPricingBasis: { action: 'SKIP', reason: 'AD_HOC' } })), { action: 'SKIP', reason: 'AD_HOC' });
  assert.deepEqual(readFrozenFreightPricingBasis(snapshotWith({})), { action: 'LOCK' });
});

// ─── freeze wiring (source scan — buildCostSnapshot is db-bound, unit law) ──

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

test('SIL-693: freeze khóa lô ghi freightPricingBasis qua ONE shared derivation (buildCostSnapshot wiring)', () => {
  const lockService = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');
  assert.match(lockService, /freightPricingBasis: await \(async \(\) => \{/);
  assert.match(lockService, /deriveLotPricingGrounds\(executor, shipmentId, \{\}\)/);
  assert.match(lockService, /grounds \? classifyLotPricingBasis\(grounds\) : null/);
});

test('SIL-693: dispatch freeze dùng cùng derivation — lockShipmentFreightRate gọi deriveLotPricingGrounds, đúng MỘT implementation', () => {
  const lifecycle = readFileSync(join(here, '../../services/freight-rate-snapshot-lifecycle.service.ts'), 'utf8');
  assert.match(lifecycle, /export async function deriveLotPricingGrounds/);
  assert.match(lifecycle, /const grounds = await deriveLotPricingGrounds\(tx, args\.shipmentId, args\)/);
  // Exactly ONE grounds read (the extracted helper) — no second inline copy.
  assert.equal((lifecycle.match(/const \[shipment\] = await tx\.select/g) ?? []).length, 1);
});
