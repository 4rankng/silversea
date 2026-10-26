// FB-145 + FB-141 (cards 231026163927 / QA R39 residuals) — the unmerge
// revert laws the R39 retest pinned, unit-only (no db, no app boot):
//   1. The PURE read rule (lcl-effective-freight): what a money board prints
//      as CƯỚC VẬN TẢI (AUTO) — channel choice (F-2) plus the FB-145 group
//      artifacts (member-zero tail, "chờ định giá lại" citation) reading
//      "Chưa xác định" on an ungrouped lot, never a stale 0₫.
//   2. The wire contract (FB-141): BKS báo khách accepts blank/null (clear ⇒
//      fallback BKS thực); BKS thực keeps its min(1) law.
//   3. Source-scan pins on the service wiring (same style as
//      lcl-gop-hang-money-wiring.test.ts): the whole-group REV unmerge clears
//      the group's loại xe off every lot, hands the FE the dissolved class
//      for [Hoàn tác], and BOTH money boards read through the ONE pure rule.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateLclTruckSchema, mergeLclRevGroupSchema } from '@tingting/shared';
import {
  effectiveLclFreight,
  type LclFreightChannelFacts,
} from '../../services/lcl-effective-freight';
import { REV_LOT_AWAITING_REPRICE_REASON } from '../../services/lcl-rev-notes';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

// ─── FB-145 — the pure read rule ────────────────────────────────────────────

const LCL = 'LCL';
const base: LclFreightChannelFacts = {
  snapshotChannel: null,
  override: null,
  revGroupId: null,
  revGroupOrder: null,
  revPrincipalRef: null,
  cargoMode: LCL,
};

test('ungrouped lot whose latest snapshot is a merge member-zero tail reads UNSET (không còn 0₫ stale)', () => {
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: { total: 0, formulaNote: 'Ghép cước cùng Bill R39B2-LCL01' },
  });
  assert.equal(out.value, null);
  assert.equal(out.reason, null);
});

test('ungrouped never-priced lot (cited-0 awaiting reprice) reads "Chưa xác định"', () => {
  // The exact QA repro: R39B2-LCL02 after Tách nhóm, reload — the citation
  // the unmerge wrote must NOT print as a live 0₫ price.
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: { total: 0, formulaNote: REV_LOT_AWAITING_REPRICE_REASON },
  });
  assert.equal(out.value, null);
});

test('ungrouped lot with its own snapshot keeps the amount (pre-merge restore tail is NOT a citation)', () => {
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: { total: 2_400_000, formulaNote: 'Tách nhóm — trở về cước thu trước ghép' },
  });
  assert.equal(out.value, 2_400_000);
  assert.equal(out.reason, null);
});

test('override channel awaiting-reprice citation reads UNSET (single-lot unmerge with a live trip)', () => {
  const out = effectiveLclFreight({
    ...base,
    override: { total: 0, reason: REV_LOT_AWAITING_REPRICE_REASON, stamped: true },
  });
  assert.equal(out.value, null);
  assert.equal(out.reason, REV_LOT_AWAITING_REPRICE_REASON);
});

test('GROUPED member still reads the merge law: 0₫ + "Ghép cước cùng Bill X" (spec §3.2 unchanged)', () => {
  const out = effectiveLclFreight({
    ...base,
    revGroupId: 'g1',
    revGroupOrder: 2,
    revPrincipalRef: 'R39B2-LCL01',
    override: { total: 0, reason: 'Ghép thu cước cùng Lô 1', stamped: true },
  });
  assert.equal(out.value, 0);
  assert.equal(out.reason, 'Ghép thu cước cùng Lô 1');
});

test('GROUPED trip-less member falls back to its materialized snapshot price (161026204709 kept)', () => {
  const out = effectiveLclFreight({
    ...base,
    revGroupId: 'g1',
    revGroupOrder: 1,
    snapshotChannel: { total: 3_900_000, formulaNote: 'Tuyến × loại xe (bảng giá)' },
  });
  assert.equal(out.value, 3_900_000);
});

test('trip-leg freezes win the snapshot channel and are never group artifacts', () => {
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: { total: 5_500_000, formulaNote: null },
  });
  assert.equal(out.value, 5_500_000);
});

test('FCL lot ignores the group law entirely (byte-for-byte snapshot channel)', () => {
  const out = effectiveLclFreight({
    ...base,
    cargoMode: 'FCL',
    revGroupId: 'g1',
    override: { total: 999, reason: 'Ghép cước cùng Bill X', stamped: true },
    snapshotChannel: { total: 1_200_000, formulaNote: 'FCL bảng giá' },
  });
  assert.equal(out.value, 1_200_000);
  assert.equal(out.reason, null);
});

test('no channels at all reads UNSET (lô mới — never a fabricated 0)', () => {
  assert.equal(effectiveLclFreight({ ...base }).value, null);
});

// ─── SIL-491 — the FB-095 crown inheritance is live money, not an artifact ──

test('SIL491-R1: ungrouped promoted survivor keeps the transferred 100% cước (crown citation, non-zero)', () => {
  // The exact ticket repro: 2-lot REV group, Lô 1 deleted — the survivor
  // dissolved (revGroupId null) and received the crown snapshot with the
  // group's whole freight. It must PRINT, never mask as "Chưa xác định".
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: {
      total: 2_000_000,
      formulaNote: 'Đón cước chính khi tách nhóm (từ Bill R42CUS-MRG-01) — 100% cước thu',
    },
  });
  assert.equal(out.value, 2_000_000);
  assert.equal(out.reason, null);
});

test('SIL491 edge: crown citation with NOTHING transferred (cited 0₫) still reads UNSET', () => {
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: {
      total: 0,
      formulaNote: 'Đón cước chính khi tách nhóm (từ Bill X) — chưa có cước thu để chuyển',
    },
  });
  assert.equal(out.value, null);
  assert.equal(out.reason, null);
});

test('SIL491-R2: promoted Lô 1 of a still-live group (≥3 lots) reads the crown money via the fallback', () => {
  const out = effectiveLclFreight({
    ...base,
    revGroupId: 'g1',
    revGroupOrder: 1,
    snapshotChannel: {
      total: 2_000_000,
      formulaNote: 'Đón cước chính khi tách nhóm (từ Bill R42CUS-MRG-01) — 100% cước thu',
    },
  });
  assert.equal(out.value, 2_000_000);
  assert.equal(out.reason, null);
});

test('SIL491 sibling: the lot\'s own re-cited price (own-cuoc marker, non-zero) prints', () => {
  const out = effectiveLclFreight({
    ...base,
    snapshotChannel: {
      total: 1_500_000,
      formulaNote: 'Tách nhóm — cước thu theo đơn giá khách × tuyến (lô độc lập)',
    },
  });
  assert.equal(out.value, 1_500_000);
  assert.equal(out.reason, null);
});

// ─── FB-141 — the wire contract: BKS báo khách blank là hợp lệ ──────────────

test('updateLclTruck: billingTruckNo chấp nhận null VÀ chuỗi rỗng (clear ⇒ fallback BKS thực)', () => {
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: null }).billingTruckNo, null);
  // '' passes trim().max(20) — the SERVICE normalizes `'' -> null` (the FB-141
  // fix at the shared owner; the old min(1) 400'd the clear).
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: '' }).billingTruckNo, '');
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: '  ' }).billingTruckNo, '');
  // A real value still round-trips.
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: '29H-77777' }).billingTruckNo, '29H-77777');
});

test('updateLclTruck: BKS THỰC giữ luật min(1) — rỗng vẫn 400', () => {
  assert.throws(() => updateLclTruckSchema.parse({ shipmentId: 1, actualTruckNo: '' }));
  assert.doesNotThrow(() => updateLclTruckSchema.parse({ shipmentId: 1, actualTruckNo: '15C-167.31' }));
});

test('mergeLclRevGroup: billingTruckNo rỗng đi qua (popup gộp để trống = fallback)', () => {
  assert.doesNotThrow(() => mergeLclRevGroupSchema.parse({
    shipmentIds: [1, 2],
    vehicleSizeClassId: 3,
    billingTruckNo: '',
  }));
});

// ─── FB-145 — service wiring pins (source-scan, same style as money-wiring) ─

test('unmergeLclGroup (REV) gỡ loại xe nhóm khỏi MỌI lô + trả vehicleClassId cho Hoàn tác', () => {
  const svc = read('../../services/lcl-grouping.service.ts');
  const unmergeGroup = svc.slice(
    svc.indexOf('export async function unmergeLclGroup'),
    svc.indexOf('export async function unmergeLclLot'),
  );
  // The class is captured BEFORE the clear (the response contract).
  assert.match(unmergeGroup, /const dissolvedVehicleClassId = input\.dimension === 'REV'/);
  assert.match(unmergeGroup, /ordered\[0\]\?\.revVehicleClassId \?\? null/);
  // Every member's patch clears the group's class stamp (acceptance FB-145:
  // "loại xe của nhóm gộp cũng phải được gỡ khỏi các lô").
  assert.match(unmergeGroup, /\.\.\.\(input\.dimension === 'REV' \? \{ revVehicleClassId: null \} : \{\}\)/);
  assert.match(unmergeGroup, /vehicleClassId: dissolvedVehicleClassId/);
  // The survivor-keeps-class law (FB-095 QA C-1) is untouched for the
  // lot-level path: dissolveGroupMembershipPatch itself clears ONLY the
  // membership columns.
  const patch = svc.slice(
    svc.indexOf('function dissolveGroupMembershipPatch'),
    svc.indexOf('/**\n * Write the renumbered survivor rows'),
  );
  assert.doesNotMatch(patch, /revVehicleClassId/);
});

test('cả 2 bảng tiền đọc qua MỘT pure rule (debit summary + accounting close)', () => {
  const summary = read('../../services/shipment-debit-summary.service.ts');
  assert.match(summary, /import \{ effectiveLclFreight \} from '\.\/lcl-effective-freight';/);
  assert.match(summary, /effectiveLclFreight\(\{/);
  assert.match(summary, /formulaText: s\.freightRateSnapshots\.formulaText/);
  const close = read('../../services/accounting-debit-close.service.ts');
  assert.match(close, /import \{ effectiveLclFreight \} from '\.\/lcl-effective-freight';/);
  assert.match(close, /effectiveLclFreight\(\{/);
  assert.match(close, /formulaText: s\.freightRateSnapshots\.formulaText/);
});
