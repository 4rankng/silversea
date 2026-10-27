// Spec 23/10 (261023110000) — money-law wiring pins (source-scan, unit-only
// tree: no db connection, no app boot). The db-bound money writes cannot run
// here; these pins assert the LAW the services carry:
//   COST (trả ĐV)  = 1 dòng/chuyến: Lô 1 = 100% cước trả ĐVVC (manual
//     "Cước trả ĐVVC" thắng bảng giá trả nhà xe; blank = auto-trace, sống
//     tới phát lệnh), thành viên 2..N = 0₫. ĐV KHÔNG viết BKS báo khách.
//   REV (thu khách) = trong nhóm CUS gộp CHỦ ĐỘNG: Lô 1 = 100% cước thu
//     (manual "Cước thu Lô 1" thắng bảng giá thu khách), Lô 2..N = 0₫ +
//     tag "Ghép thu cước cùng Lô 1". Ruling 21/10 (thu per-lot) vẫn là
//     DEFAULT ngoài nhóm gộp (setLclLotRevClass per-lot outputs).
//   Tách nhóm = FB-095/FB-093: Lô 1 rời ⇒ chuyển 100% cho Lô kế; tách cả
//     nhóm ⇒ tiền về pre-merge; 1 thành viên về riêng ⇒ cước giữ nguyên +
//     lý do chờ định giá lại.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const svc = read('../../services/lcl-grouping.service.ts');
const freight = read('../../services/lcl-cost-group-freight.service.ts');

const assign = () => svc.slice(
  svc.indexOf('export async function assignLclCostGroup'),
  svc.indexOf('Spec 23/10 (261023110000) — SỬA 4 trường'),
);
const update = () => svc.slice(
  svc.indexOf('export async function updateLclCostGroup'),
  svc.indexOf('FB-093 — CUS "Ghép cước thu khách" (REV dimension). Spec 23/10'),
);
const merge = () => svc.slice(
  svc.indexOf('export async function mergeLclRevGroup'),
  svc.indexOf('export async function setLclLotRevClass'),
);

// ─── LCL2310-05 (COST half) + LCL2310-04 — 100/0 trả ĐV, auto vs override ──

test('COST stays 1 dòng/chuyến (Lô 1 = 100% cước trả ĐVVC, members 0₫)', () => {
  assert.match(assign(), /applyPrincipalCostFreight\(tx,/);
  assert.match(assign(), /externalFreightCost: '0'/);
  assert.doesNotMatch(assign(), /allocateGroupFreight/); // no per-lot cost split
});

test('Cước trả ĐVVC: nhập tay thắng bảng giá — và sống tới phát lệnh', () => {
  // Assignment: manual wins over the board trace (the same order in BOTH
  // assign and update — number = override, null = auto-trace).
  assert.match(freight, /if \(manualFreightCost != null\) \{[\s\S]*?externalFreightCost: String\(manualFreightCost\)[\s\S]*?source: 'MANUAL'/);
  assert.match(assign(), /manualFreightCost: input\.freightCost/);
  assert.match(update(), /manualFreightCost: input\.freightCost \?\? undefined/);
  // The sticky column keeps the override for the issuance hook ("phát lệnh"
  // creates trips AFTER grouping) and beats the trace there too.
  assert.match(assign(), /costGroupFreightManual: index === 0 \? \(input\.freightCost != null \? String\(input\.freightCost\) : null\) : null/);
  assert.match(freight, /if \(shipment\.costGroupFreightManual != null\) \{[\s\S]*?externalFreightCost: shipment\.costGroupFreightManual/);
});

test('SỬA nhóm ĐV là PARTIAL update: bỏ trống = GIỮ Nhà xe + tiền (review H1)', () => {
  const u = update();
  // Omitted carrier re-resolves the group's PERSISTED identity — a one-field
  // payload never wipes the Nhà xe (and never reprices on the generic lane).
  assert.match(u, /input\.carrierId != null \|\| input\.carrierType != null/);
  assert.match(u, /plannedExternalCarrierId/);
  // 3-state money: only an explicit freightCost (number | null) touches money
  // and the manual column; omitted leaves both untouched.
  assert.match(u, /const moneyChanged = input\.freightCost !== undefined/);
  assert.match(u, /\.\.\.\(moneyChanged\s*\?\s*\{ costGroupFreightManual:/);
});

test('ĐV assign/update never write BKS báo khách (XÓA khỏi flow ĐV)', () => {
  assert.doesNotMatch(assign(), /billingTruckNo/);
  assert.doesNotMatch(update(), /billingTruckNo/);
});

test('service writes through the law patches (independence seam is wired)', () => {
  assert.match(assign(), /tx\.update\(s\.shipments\)\.set\(costGroupMemberPatch\(/);
  assert.match(update(), /tx\.update\(s\.shipments\)\.set\(costGroupMemberPatch\(/);
  assert.match(merge(), /tx\.update\(s\.shipments\)\.set\(revGroupMemberPatch\(/);
});

// ─── LCL2310-05 (REV half) — 100/0 trong nhóm CUS gộp + tag ────────────────

test('REV merge: Lô 1 = 100% cước thu nhóm, Lô 2..N = 0₫ + tag "Ghép thu cước cùng Lô 1"', () => {
  const m = merge();
  // Members zero out citing the spec tag (the API's field/tag is the same
  // constant — LCL_REV_MERGE_TAG, pinned in lcl-gop-hang-split-law).
  assert.match(m, /revenue: '0',/);
  assert.match(m, /revenueOverrideReason: LCL_REV_MERGE_TAG/);
  assert.match(m, /insertRevMergeSnapshot\(tx, row\.id, 0, `\$\{LCL_REV_MERGE_TAG\}/);
  // Lô 1 carries the whole group's cước thu.
  assert.match(m, /Lô 1 giữ 100% cước thu nhóm/);
});

test('Cước thu Lô 1: nhập tay (freightRevenue) thắng auto bảng giá thu khách', () => {
  const m = merge();
  assert.match(m, /const amount = input\.freightRevenue \?\? \(price != null \? price\.price : null\)/);
  assert.match(m, /const price = input\.freightRevenue == null/); // manual skips the trace entirely
  // Per-lot outputs share the same auto-vs-override law.
  const perLot = svc.slice(
    svc.indexOf('export async function setLclLotRevClass'),
    svc.indexOf('export async function updateLclGroupTruck'),
  );
  assert.match(perLot, /const amount = input\.freightRevenue \?\? \(price != null \? price\.price : null\)/);
});

// ─── LCL2310-06 — tách nhóm (FB-095 promote + FB-093 restore) ──────────────

test('tách Lô 1 (REV) chuyển 100% cước cho Lô kế — nhóm không về 0₫', () => {
  const promote = svc.slice(
    svc.indexOf('async function promotePrincipalOnRemoval'),
    svc.indexOf('export async function unmergeLclGroup'),
  );
  assert.match(promote, /Đón cước chính khi tách nhóm/);
  assert.match(promote, /Tách nhóm — chuyển 100% cước cho Bill/);
  // COST: the manual "Cước trả ĐVVC" follows the crown like the freight line.
  assert.match(promote, /rewriteSurvivors\(tx, dimension, survivors, groupId, actor, leaver\.costGroupFreightManual \?\? null\)/);
});

test('tách 1 lô về riêng + tách cả nhóm: tiền về đúng trạng thái trước ghép', () => {
  // Whole-group "Tách nhóm" (CUS "hủy gộp về lại từng xe riêng") restores the
  // PRE-MERGE capture (review C1 — not the stale M2.1 first-override
  // original; a captured NULL restores to null, never a bare 0₫).
  assert.match(merge(), /revenuePreGroup: trip\.revenue,\s*revenuePreGroupCaptured: true/);
  assert.match(svc, /trip\.revenuePreGroupCaptured/);
  assert.match(svc, /\? \{ revenue: trip\.revenuePreGroup \}/);
  assert.match(svc, /await restoreRevPreMergeMoney\(tx, member, tripFacts\.get\(member\.id\) \?\? null\)/);
  // A single member leaving keeps its current cước + a fresh reason
  // (cited 0₫ ⇒ chờ định giá lại; own cước ⇒ per-lot marker) and sheds its
  // capture (it left the group). SIL-539 retry: the facts resolve per leaver
  // position — the member reads the pre-loaded map, the PRIMARY reloads its
  // trip facts AFTER the promotion wrote the 0₫ transfer stamp (the stale map
  // still holds the moved 100% and would defeat the own-money guard).
  assert.match(svc, /await restateRevLeaverMoney\(tx, leaver, leaverTrip, actor\)/);
  assert.match(svc, /const leaverTrip = leaverOrder === 1\n {8}\? \(await loadLiveTripFactsByShipment\(tx, \[leaver\.id\]\)\)\.get\(leaver\.id\) \?\? null/);
  const restate = svc.slice(
    svc.indexOf('async function restateRevLeaverMoney'),
    svc.indexOf('function auditGroupChange'),
  );
  assert.match(restate, /REV_LOT_AWAITING_REPRICE_REASON/);
  assert.match(restate, /REV_LOT_OWN_CUOC_REASON/);
  assert.match(restate, /revenuePreGroupCaptured: false/);
});

test('BKS fallback có mặt đúng 3 consumption site (draft + 2 freeze)', () => {
  const draft = read('../../services/billing-document-draft.service.ts');
  const lock = read('../../services/shipment-cost-lock.service.ts');
  assert.match(draft, /cargoMode === 'LCL'\s*\?\s*effectiveBillingPlate\(input\.trip\)/);
  // Freeze materializes the REPORTED plate into the frozen lot record (both
  // the single-lot and the consolidated export) — legacy frozen docs keep
  // their original law (billing-only) per review M2.
  assert.equal((lock.match(/effectiveBillingPlate\(lot\)/g) ?? []).length, 2);
  const legacy = read('../../services/billing-export-shared.service.ts');
  assert.doesNotMatch(legacy, /effectiveBillingPlate/);
});

test('default per-lot (ruling 21/10) giữ nguyên ngoài nhóm gộp', () => {
  // setLclLotRevClass is the per-lot DEFAULT channel: it never creates a
  // rev group and never moves cước TRẢ (ĐV) money.
  const perLot = svc.slice(
    svc.indexOf('export async function setLclLotRevClass'),
    svc.indexOf('export async function updateLclGroupTruck'),
  );
  assert.doesNotMatch(perLot, /revGroupId:/);          // no group created
  assert.doesNotMatch(perLot, /costGroup|externalFreightCost/); // ĐV untouched
  // The same-customer guard of the merge path is wired to the pure law.
  assert.match(merge(), /findRevCustomerConflict\(/);
  assert.match(merge(), /assertSameRevCustomer\(/);
});

// ─── SIL-493 — tiền COST đổ lên lô nào thì "Cước trả dự kiến" của lô đó thấy─

test('SIL-493: mirror planned_carrier_cost ở CẢ 4 seam tiền COST đổ bộ (tách/promote/gán/phát lệnh)', () => {
  // ONE shared helper — the money holder's plan estimate stays board truth.
  assert.match(freight, /export async function mirrorPlannedCarrierCost/);
  // No amount ⇒ no write (an absent price is never a fabricated 0₫).
  assert.match(freight, /if \(amount == null \|\| Number\(amount\) === 0\) return;/);
  // applyPrincipalCostFreight (manual + board) + issuance hook (manual + board).
  assert.equal((freight.match(/await mirrorPlannedCarrierCost\(/g) ?? []).length, 4);
  // Whole-group COST tách (Lô 1 keeps) + COST promote (promotee inherits).
  assert.equal((svc.match(/await mirrorPlannedCarrierCost\(/g) ?? []).length, 2);
});

test('SIL-493: Tách nhóm COST — Lô 1 giữ manual ?? trip freight, mirror lên editor; member không bị mirror', () => {
  const dissolve = svc.slice(
    svc.indexOf('export async function unmergeLclGroup'),
    svc.indexOf('async function restoreRevPreMergeMoney'),
  );
  assert.match(dissolve, /const kept = principal\.costGroupFreightManual \?\? tripFreight;/);
  assert.match(dissolve, /await mirrorPlannedCarrierCost\(tx, principal\.id, kept\);/);
  assert.match(dissolve, /input\.dimension === 'COST'/);
});

test('SIL-493: Hủy ghép COST (promote) — promotee "nhận 100% cước trả ĐV" thấy được trong editor', () => {
  const promote = svc.slice(
    svc.indexOf('async function promotePrincipalOnRemoval'),
    svc.indexOf('export async function unmergeLclGroup'),
  );
  assert.match(promote, /await mirrorPlannedCarrierCost\(tx, promotee\.id, freight\);/);
});
