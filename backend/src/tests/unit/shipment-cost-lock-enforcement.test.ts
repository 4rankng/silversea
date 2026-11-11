/**
 * Audit 2026-11-04 §2.3 — the lot cost lock gates EVERY ops money write on a
 * lot (PRD O2C §7.9: "Sửa chi phí bị chặn khi lô đã khóa"), not just the L2
 * debit-edits surface that already carried it. Static source pins (unit-only
 * tree): the db-bound writes cannot run here; these assert the LAW each
 * surface now carries — assertShipmentCostUnlocked beside the existing
 * accounting-lock assert, for every member lot of a composition change, with
 * tracking-reality fields (phoi-phieu deposit dates/money-received) left
 * writable. R2 (QA comment 3834): the accounting-origin MONEY edits
 * (updateAccountingExpense, its composed correction, the phoi-phieu row void
 * and the ops-side row delete) gate too — the Q5 question the verdict
 * answered; the trip-link branch and evidence-only edits stay ungated.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const grouping = read('../../services/lcl-grouping.service.ts');
const opsExpenses = read('../../services/ops-expenses.service.ts');
const forwarder = read('../../services/forwarder.service.ts');
const reads = read('../../services/expense-accounting-reads.service.ts');
const costLock = read('../../services/shipment-cost-lock.service.ts');

const slice = (source: string, from: string, to: string) => source.slice(
  source.indexOf(from),
  source.indexOf(to, source.indexOf(from)),
);

test('lcl-grouping: merge AND unmerge gate EVERY member lot on both locks', () => {
  const body = slice(grouping, 'async function assertMergeableMoney', '// ─── FB-095 — un-merge safety');
  assert.match(body, /await assertShipmentAccountingUnlocked\(tx, row\.id\);\s*await assertShipmentCostUnlocked\(tx, row\.id\);/);
  // assertGroupMutable (the unmerge path) funnels into assertMergeableMoney —
  // one seam, both dimensions, all members.
  const groupMutable = slice(grouping, 'async function assertGroupMutable', '/** Lock + load the live members');
  assert.match(groupMutable, /await assertMergeableMoney\(tx, members, tripFacts\);/);
});

test('lcl-grouping: setLclLotRevClass refuses a cost-locked lot (money write)', () => {
  const body = slice(grouping, 'export async function setLclLotRevClass', '/**\n * FB-093 — quick-edit the BKS pair');
  assert.match(body, /await assertShipmentAccountingUnlocked\(tx, row\.id\);\s*await assertShipmentCostUnlocked\(tx, row\.id\);/);
});

test('lcl-grouping: group truck edits carry the whole-group cost boundary with a named-lot message', () => {
  const body = slice(grouping, 'export async function updateLclGroupTruck', 'export async function unmergeLclLot');
  // Named lot.
  assert.match(body, /await assertShipmentAccountingUnlocked\(tx, row\.id\);\s*await assertShipmentCostUnlocked\(tx, row\.id\);/);
  // Every group member on an actual-plate rewrite — the cost lock gets its
  // own message so the 409 names the dimension that refused.
  assert.match(body, /try \{\s*\/\/ Audit 2026-11-04 §2\.3[\s\S]*?await assertShipmentCostUnlocked\(tx, target\.id\);\s*\} catch \{\s*throw new ApiError\(409, `Nhóm ghép đã khóa chi phí — Lô \$\{lotReference\(target\)\} đang khóa, không sửa BKS thực của nhóm được`\);/);
});

test('ops-expenses: create and update sit beside the accounting-lock assert', () => {
  const create = slice(opsExpenses, 'export async function createOpsExpense', 'export async function updateOpsExpense');
  assert.match(create, /await assertShipmentAccountingUnlocked\(executor, input\.shipmentId\);\s*\/\/ Audit 2026-11-04[\s\S]*?await assertShipmentCostUnlocked\(executor, input\.shipmentId\);/);
  const update = slice(opsExpenses, 'export async function updateOpsExpense', 'export async function deleteOpsExpense');
  assert.match(update, /await assertShipmentAccountingUnlocked\(executor, entry\.shipmentId\);\s*\/\/ Audit 2026-11-04[\s\S]*?await assertShipmentCostUnlocked\(executor, entry\.shipmentId\);/);
  // Q5 boundary: deletes keep their existing governance untouched (the plan
  // scopes enforcement to create/update).
});

test('forwarder: the trip helper mirrors the accounting variant byte-for-byte (wave link + fail-open)', () => {
  const helper = slice(costLock, 'export async function assertTripShipmentCostUnlocked', '/** Server-assembled frozen Lớp-1 totals');
  assert.match(helper, /coalesce\(\$\{s\.trips\.shipmentId\}, \$\{s\.shipmentFulfillments\.shipmentId\}\)/);
  assert.match(helper, /leftJoin\(s\.shipmentFulfillments, eq\(s\.shipmentFulfillments\.id, s\.trips\.fulfillmentId\)\)/);
  // Soft-deleted lot ⇒ unlocked (nothing live to protect)…
  assert.match(helper, /if \(shipment && shipment\.deletedAt == null\) \{\s*await assertShipmentCostUnlocked\(executor, trip\.shipmentId\);/);
  // …and no resolvable lot ⇒ allow (fail-open, the accounting variant's own
  // ruling — `if (trip.shipmentId != null)` guards the only throw path).
  assert.match(helper, /if \(trip\.shipmentId != null\) \{/);
  assert.doesNotMatch(helper, /assertShipmentAccountingUnlocked/);
});

test('forwarder: create/update/delete trip expenses all gate through the trip helper', () => {
  const create = slice(forwarder, 'export async function createTripExpense', 'export async function updateTripExpense');
  assert.match(create, /await assertTripShipmentAccountingUnlocked\(executor, data\.tripId\);\s*\/\/ Audit 2026-11-04[\s\S]*?await assertTripShipmentCostUnlocked\(executor, data\.tripId\);/);
  const update = slice(forwarder, 'export async function updateTripExpense', 'export async function updateForwarderTripExpense');
  assert.match(update, /await assertTripShipmentAccountingUnlocked\(executor, existing\.tripId\);\s*await assertTripShipmentCostUnlocked\(executor, existing\.tripId\);/);
  const del = slice(forwarder, 'export async function deleteTripExpenseInTx', 'export async function getTripExpenseAuditInfo');
  assert.match(del, /await assertTripShipmentAccountingUnlocked\(executor, existing\.tripId\);\s*await assertTripShipmentCostUnlocked\(executor, existing\.tripId\);/);
  // The trips-route hard-delete variant carries the same gate.
  const guarded = slice(forwarder, 'export async function deleteTripExpenseGuarded', '\n}');
  assert.match(guarded, /await assertTripShipmentAccountingUnlocked\(executor, tripId\);\s*await assertTripShipmentCostUnlocked\(executor, tripId\);/);
});

test('expense-accounting-reads: an ACTIVE cost lock locks the row so the board disables it up front', () => {
  assert.match(reads, /executor\.select\(\{ shipmentId: s\.shipmentCostLocks\.shipmentId \}\)\.from\(s\.shipmentCostLocks\)\.where\(and\(inArray\(s\.shipmentCostLocks\.shipmentId, shipmentIds\), isNull\(s\.shipmentCostLocks\.unlockedAt\)\)\)/);
  assert.match(reads, /locked: row\.status !== 'RECORDED' \|\| !!row\.confirmedAt \|\| !!row\.reconciliationId \|\| locks\.some\(lock => lock\.shipmentId === row\.shipmentId\)\s*\|\| costLocks\.some\(lock => lock\.shipmentId === row\.shipmentId\)/);
});

test('PRD §7.9 boundary: tracking-reality writes stay untouched', () => {
  // SIL-679 r2 (QA comment 3834 §3b): the phoi-phieu ROW VOID is a lot-cost
  // write and gates beside the accounting lock. The tracking-reality writes
  // in the same file — setPhoiPhieuDeposit (dates / money-received) and the
  // phoi-meta update — stay writing under a cost lock per PRD §7.9: their
  // slices carry no cost-lock assert.
  const phoiPhieu = read('../../services/phoi-phieu-control.service.ts');
  const voidRow = slice(phoiPhieu, 'export async function voidPhoiPhieuRow', '// ── Card 20260921_14');
  assert.match(voidRow, /await assertShipmentAccountingUnlocked\(tx, source\.shipmentId\);\s*\/\/ SIL-679 r2[\s\S]*?await assertShipmentCostUnlocked\(tx, source\.shipmentId\);/);
  const deposit = slice(phoiPhieu, 'export async function setPhoiPhieuDeposit', '\n}');
  assert.doesNotMatch(deposit, /assertShipmentCostUnlocked/);
  const meta = slice(phoiPhieu, 'export async function updatePhoiPhieuMeta', '\n}');
  assert.doesNotMatch(meta, /assertShipmentCostUnlocked/);
});

test('SIL-679 r2: accounting-origin money edits gate on the cost lock (QA comment 3834 §3a)', () => {
  const writes = read('../../services/expense-accounting-write.service.ts');
  // The money branch of updateAccountingExpense (non-evidence-only) refuses
  // under an ACTIVE cost lock; the correction flow composes this same
  // function, so điều chỉnh bút toán rides the same boundary.
  const update = slice(writes, 'export async function updateAccountingExpense', '/** Customer-billing projection');
  assert.match(update, /if \(!evidenceOnly\) \{\s*await assertExpenseSourceMutable\(tx, before\);\s*\/\/ SIL-679 r2[\s\S]*?await assertShipmentCostUnlocked\(tx, before\.shipmentId\);\s*\}/);
  // The trip-link branch and evidence-only edits keep their existing
  // governance — the gate rides the money branch only.
  const tripLink = slice(update, 'if (input.tripId && Object.keys', 'if (input.tripId) throw');
  assert.doesNotMatch(tripLink, /assertShipmentCostUnlocked/);
  // The OPS-side row delete voids lot money too — the same sweep closes it.
  const opsExpenses = read('../../services/ops-expenses.service.ts');
  const del = slice(opsExpenses, 'export async function deleteOpsExpense', '/**\n * The same uploaded object');
  assert.match(del, /await assertShipmentCostUnlocked\(executor, source\.shipmentId\);/);
});

test('SIL-803: expense CREATE gates the cost lock on both lanes (phoi-phieu write path)', () => {
  const create = read('../../services/expense-accounting-create.service.ts');
  // Lot lane — the phoi-phieu "+ Chi phí" drawer POSTs here: the single
  // /entries and the /entries/batch routes both funnel through
  // createAccountingExpense, so this seam closes the write the ticket
  // repro'd (lot 812 accepted entries while costLockedAt stood). The gate
  // sits right beside the accounting assert, ops-expenses create lane.
  const lot = slice(create, 'async function createShipmentLevelAccountingExpense', '/**\n * The trip-scoped tail');
  assert.match(lot, /await assertShipmentAccountingUnlocked\(tx, input\.shipmentId\);\s*\/\/ SIL-803 \(id 929\)[\s\S]*?await assertShipmentCostUnlocked\(tx, input\.shipmentId\);/);
  // Trip lane — a trip-scoped create on a locked lot refuses with the same
  // law (the mirror of its accounting assert).
  const trip = slice(create, 'await lockTripFinancialAuthority', 'const [trip] = await tx.select');
  assert.match(trip, /await assertTripShipmentAccountingUnlocked\(tx, input\.tripId\);\s*\/\/ SIL-803 \(id 929\)[\s\S]*?await assertTripShipmentCostUnlocked\(tx, input\.tripId\);/);
  // The batch route needs no separate gate — one seam, every lane covered.
  const routes = read('../../routes/expense-accounting.ts');
  const batch = slice(routes, "'/entries/batch'", 'router.post');
  assert.match(batch, /createAccountingExpense\(tx, getUser\(req\), item\)/);
  assert.doesNotMatch(batch, /assertShipmentCostUnlocked/);
});
