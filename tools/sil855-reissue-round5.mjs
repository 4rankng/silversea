// SIL-855 runbook — RE-POST đợt chốt round 5 trên STAGING: unlock → khóa lại
// (freeze đủ cước) → phát hành lại note đủ tiền 8.536.320 ₫.
//
// Context: note nửa tiền #26 (4.268.160/8.536.320) đã CANCELED governed bởi
// tools/sil855-cancel-round5-note.mjs (commit 293e932d). Kết luận RE-POST vs
// CORRECTION: RE-POST — luồng điều chỉnh nguồn (DEBIT_NOTE_ADJUSTMENT) tính
// chênh lệch từ snapshot khóa lô, mà snapshot của SHP-2611-00307 (lô 801)
// froze freightAuto/receivableTotal null → diff = 0 → 409 'Không có chênh lệch
// nguồn'. Còn unlock+khóa lại giờ khả thi vì claim đã nhả và fix 5d42086a làm
// buildCostSnapshot đọc ghi đè cước SIL-805 mức-lô khi freeze.
//
// Run INSIDE the staging backend container (staging = /opt/vantai on
// vantai.tingting.vip; NEVER the silversea.tingting.vip prod stack):
//
//   ssh root@vantai.tingting.vip "cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml exec -T backend node --input-type=module" \
//     < tools/sil855-reissue-round5.mjs
//   (Dry-run: thêm -e SIL855_DRY_RUN=1 vào docker compose exec)
//
// Guarantees:
// - IDEMPOTENT: re-run after success thấy note LIVE đủ tiền → verify-only.
// - SHAPE-GUARDED: round money, lot set, note states, override cước, snapshot
//   freeze totals — assert trước mọi mutation; lệch shape → abort exit 3.
// - GOVERNED ONLY: unlock qua unlockShipmentCost, khóa lại qua
//   lockShipmentCost (freeze 5d42086a đọc ghi đè ô Cước thu), phát hành qua
//   createConsolidatedDebitNote (assertRoundIssuanceTotals bên trong) —
//   không UPDATE/DELETE row trực tiếp.
// - SCOPED: chỉ đụng lô 800/801 của round 5; các bảng khác READ.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './dist/db/index.js';
import * as s from './dist/db/schema/index.js';
import { lockShipmentCost, unlockShipmentCost, createConsolidatedDebitNote } from './dist/services/shipment-cost-lock.service.js';
import { getDebitNoteRoundPreview } from './dist/services/debit-settlement-rounds.service.js';
import { assertRoundIssuanceTotals } from './dist/services/debit-settlement-shared.js';
import { invalidateReportCaches } from './dist/lib/report-cache.js';
import { ApiError } from './dist/errors.js';

// ─── Expected staging shape (recon 2026-11-23, build 1aec2e01) ──────────────
const ROUND_ID = 5;
const EXPECTED_ROUND = { amount: 7_904_000, vatRate: 8 };            // gross 8.536.320
const EXPECTED_ROUND_GROSS = 8_536_320;
const EXPECTED_FREIGHT = 3_952_000;                                   // mỗi lô
const EXPECTED_LOT_CODES = ['SHP-2611-00306', 'SHP-2611-00307'];
const UNLOCK_REASON = 'SIL-855 — snapshot khóa lô froze null cước (ghi đè SIL-805 chưa được đọc lúc khóa); mở khóa để khóa lại đủ tiền trước khi phát hành lại round 5';
const RELOCK_NOTE = 'SIL-855 — khóa lại sau khi freeze đọc đủ ghi đè cước thu (runbook reissue round 5)';

const log = (...parts) => console.log('[sil855]', ...parts);
const fail = (code, ...parts) => { console.error('[sil855] ABORT', ...parts); process.exit(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshotNum = (snapshot, key) => {
  if (snapshot == null || typeof snapshot !== 'object') return null;
  const value = snapshot[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};
// billingDocumentIsLive law: tồn tại + chưa soft-delete + không CANCELED.
const docIsLive = (doc) => doc.deletedAt == null && doc.debitNoteStatus !== 'CANCELED';
// SIL855_DRY_RUN=1 → guards + reads only; verdict exits 4 (expected pre-state).
const DRY_RUN = process.env.SIL855_DRY_RUN === '1';
if (DRY_RUN) log('DRY-RUN mode: guards + reads only, no unlock/relock/issue.');

// ─── G1: round record is the money-law anchor ────────────────────────────────
const [round] = await db.select({
  id: s.debitSettlementRounds.id, customerId: s.debitSettlementRounds.customerId,
  direction: s.debitSettlementRounds.direction, roundNo: s.debitSettlementRounds.roundNo,
  periodKey: s.debitSettlementRounds.periodKey, amount: s.debitSettlementRounds.amount,
  vatRate: s.debitSettlementRounds.vatRate,
}).from(s.debitSettlementRounds).where(eq(s.debitSettlementRounds.id, ROUND_ID)).limit(1);
if (!round) fail(3, 'G1: đợt chốt id', ROUND_ID, 'không tồn tại trên staging.');
log('G1 round row:', JSON.stringify(round));
if (round.direction !== 'THU') fail(3, 'G1: round direction', round.direction, '≠ THU');
if (Number(round.amount) !== EXPECTED_ROUND.amount || round.vatRate !== EXPECTED_ROUND.vatRate) {
  fail(3, 'G1: round money', round.amount, 'vat', round.vatRate, '≠ expected', EXPECTED_ROUND);
}
assertRoundIssuanceTotals({ net: EXPECTED_ROUND.amount, tax: EXPECTED_ROUND_GROSS - EXPECTED_ROUND.amount, gross: EXPECTED_ROUND_GROSS }, round);
log(`G1 money law OK: đợt ${EXPECTED_ROUND.amount} + VAT ${EXPECTED_ROUND.vatRate}% = ${EXPECTED_ROUND_GROSS} ₫`);

// ─── G2: lot set + note states for the round ─────────────────────────────────
const roundLots = await db.select({
  shipmentId: s.debitSettlementRoundLots.shipmentId,
  shipmentCode: s.shipments.shipmentCode,
}).from(s.debitSettlementRoundLots)
  .innerJoin(s.shipments, eq(s.shipments.id, s.debitSettlementRoundLots.shipmentId))
  .where(eq(s.debitSettlementRoundLots.roundId, ROUND_ID));
const lotIds = roundLots.map((row) => row.shipmentId).sort((a, b) => a - b);
const lotCodes = roundLots.map((row) => row.shipmentCode).sort();
log('G2 round lots:', JSON.stringify(roundLots.map((row) => ({ id: row.shipmentId, code: row.shipmentCode }))));
if (!same(lotCodes, EXPECTED_LOT_CODES)) fail(3, 'G2: lot codes', lotCodes, '≠ expected', EXPECTED_LOT_CODES);

const roundDocs = (await db.select().from(s.billingDocuments).where(and(
  eq(s.billingDocuments.settlementRoundId, ROUND_ID),
  eq(s.billingDocuments.type, 'DEBIT_NOTE'),
  isNull(s.billingDocuments.deletedAt),
)));
const liveDocs = roundDocs.filter(docIsLive);
const canceledDocs = roundDocs.filter((doc) => doc.debitNoteStatus === 'CANCELED');
log('G2 doc rows for round 5:', JSON.stringify(roundDocs.map((d) => ({
  id: d.id, status: d.debitNoteStatus, net: Number(d.totalNet), tax: Number(d.totalTax), gross: Number(d.totalGross), deletedAt: d.deletedAt,
}))));
const alreadyRepaired = liveDocs.length === 1 && Number(liveDocs[0].totalGross) === EXPECTED_ROUND_GROSS;
const halfNoteStillLive = liveDocs.some((doc) => Number(doc.totalGross) !== EXPECTED_ROUND_GROSS);
if (halfNoteStillLive) fail(3, 'G2: còn note LIVE khác nửa tiền cho round 5 — hủy governed trước (tools/sil855-cancel-round5-note.mjs).');
if (canceledDocs.length === 0 && !alreadyRepaired) fail(3, 'G2: không thấy note nửa tiền đã CANCELED (#26) — state staging khác recon, abort.');

// ─── G3: SIL-805 cước override present for the refreeze (801 froze null) ─────
const overrideRows = await db.select()
  .from(s.shipmentDebitRateOverrides)
  .where(and(
    inArray(s.shipmentDebitRateOverrides.shipmentId, lotIds),
    isNull(s.shipmentDebitRateOverrides.shipmentContainerId),
  ));
log('G3 cuoc-thu override rows (containerId null):', JSON.stringify(overrideRows.map((r) => ({ shipmentId: r.shipmentId, cuocThu: r.cuocThu }))));
const overrideByLot = new Map(overrideRows.map((r) => [r.shipmentId, r.cuocThu == null || r.cuocThu === '' ? null : Number(r.cuocThu)]));

// ─── G4: actor — the CANCELED half-note's creator (the idempotency record of
// this selection belongs to THEM; a different actor 409s actor-collision, and
// the replay of their dead record is exactly the SIL-727 stale-replay repair
// path that re-issues governed). Fallback: lowest-id ACTIVE ADMIN.
const [halfNote] = canceledDocs;
const [creatorRow] = halfNote == null ? [undefined] : await db.select({
  id: s.users.id, username: s.users.username, fullName: s.users.fullName, role: s.users.role,
}).from(s.users)
  .where(and(eq(s.users.id, halfNote.createdBy), eq(s.users.status, 'ACTIVE'), isNull(s.users.deletedAt)))
  .limit(1);
let actorRow = creatorRow;
if (actorRow == null) {
  [actorRow] = await db.select({ id: s.users.id, username: s.users.username, fullName: s.users.fullName, role: s.users.role })
    .from(s.users)
    .where(and(eq(s.users.role, 'ADMIN'), eq(s.users.status, 'ACTIVE'), isNull(s.users.deletedAt)))
    .orderBy(s.users.id).limit(1);
}
if (!actorRow) fail(3, 'G4: không có user ACTIVE hợp lệ để ghi audit.');
const actor = { userId: actorRow.id, username: actorRow.username, email: null, fullName: actorRow.fullName, role: actorRow.role };
log('G4 actor:', JSON.stringify(actorRow), creatorRow ? '(creator của note nửa tiền — replay idempotency governed)' : '(fallback ADMIN)');

// ─── V0: books baseline (live DEBIT_NOTE gross, toàn hệ thống) ───────────────
const allDocs = (await db.select({
  id: s.billingDocuments.id, entityId: s.billingDocuments.entityId, status: s.billingDocuments.debitNoteStatus,
  deletedAt: s.billingDocuments.deletedAt, gross: s.billingDocuments.totalGross,
}).from(s.billingDocuments).where(eq(s.billingDocuments.type, 'DEBIT_NOTE')));
const liveGross = allDocs.filter(docIsLive).reduce((sum, d) => sum + Number(d.gross), 0);
log(`V0 books baseline: Tổng LIVE DEBIT_NOTE gross = ${liveGross} ₫ (sau cancel note nửa tiền)`);

// ─── A1: per-lot unlock → relock (freeze 5d42086a đọc ghi đè cước) ───────────
const activeLocks = await db.select({
  shipmentId: s.shipmentCostLocks.shipmentId, id: s.shipmentCostLocks.id,
  snapshot: s.shipmentCostLocks.costSnapshot,
}).from(s.shipmentCostLocks)
  .where(and(inArray(s.shipmentCostLocks.shipmentId, lotIds), isNull(s.shipmentCostLocks.unlockedAt)));
log('A0 active locks pre-run:', JSON.stringify(activeLocks.map((l) => ({
  shipmentId: l.shipmentId, lockId: l.id,
  freightAuto: snapshotNum(l.snapshot, 'freightAuto'), receivableTotal: snapshotNum(l.snapshot, 'receivableTotal'),
}))));

for (const lotId of lotIds) {
  const lock = activeLocks.find((l) => l.shipmentId === lotId);
  const frozenFreight = lock ? snapshotNum(lock.snapshot, 'freightAuto') : null;
  const cellOverride = overrideByLot.get(lotId) ?? null;
  const expectedFreight = cellOverride ?? EXPECTED_FREIGHT;
  if (expectedFreight !== EXPECTED_FREIGHT) {
    fail(3, `A1: lô ${lotId} ghi đè cước ${cellOverride} ≠ ${EXPECTED_FREIGHT} — state khác recon, abort.`);
  }
  if (lock && frozenFreight === EXPECTED_FREIGHT) {
    log(`A1 lô ${lotId}: lock active + snapshot đủ cước ${frozenFreight} ₫ — skip unlock/relock.`);
    continue;
  }
  if (DRY_RUN) {
    log(`A1 lô ${lotId}: DRY-RUN — would unlock (lock ${lock ? lock.id : 'none'}, frozen ${frozenFreight}) → relock.`);
    continue;
  }
  if (lock) {
    const unlocked = await unlockShipmentCost({ shipmentId: lotId, reason: UNLOCK_REASON, actor });
    log(`A1 lô ${lotId}: unlocked lock #${unlocked.id} tại ${unlocked.unlockedAt}`);
  } else {
    log(`A1 lô ${lotId}: không có lock active — khóa mới.`);
  }
  const locked = await lockShipmentCost({ shipmentId: lotId, lockNote: RELOCK_NOTE, actor, idempotencyKey: `sil855-round5-relock-${lotId}` });
  log(`A1 lô ${lotId}: relocked #${locked.id} bởi ${locked.lockedByName ?? locked.lockedBy}`);
}

// ─── A2: refrozen snapshots must carry the freight for EVERY lot ─────────────
const locksNow = await db.select({
  shipmentId: s.shipmentCostLocks.shipmentId, id: s.shipmentCostLocks.id,
  snapshot: s.shipmentCostLocks.costSnapshot,
}).from(s.shipmentCostLocks)
  .where(and(inArray(s.shipmentCostLocks.shipmentId, lotIds), isNull(s.shipmentCostLocks.unlockedAt)));
const freezeCheck = locksNow.map((l) => ({
  shipmentId: l.shipmentId, lockId: l.id,
  freightAuto: snapshotNum(l.snapshot, 'freightAuto'), receivableTotal: snapshotNum(l.snapshot, 'receivableTotal'),
}));
log('A2 active locks post-run:', JSON.stringify(freezeCheck));
if (!DRY_RUN) {
  if (locksNow.length !== lotIds.length) fail(3, 'A2: không phải mọi lô đều có lock active sau khóa lại.');
  for (const check of freezeCheck) {
    if (check.freightAuto !== EXPECTED_FREIGHT || check.receivableTotal !== EXPECTED_FREIGHT) {
      fail(3, `A2: snapshot lô ${check.shipmentId} freightAuto=${check.freightAuto} receivableTotal=${check.receivableTotal} ≠ ${EXPECTED_FREIGHT} — freeze vẫn thiếu cước, abort (không phát hành).`);
    }
  }
}

// ─── A3: preview must now show EVERY lot with money + the round totals ───────
let previewOutcome = null;
try {
  const preview = await getDebitNoteRoundPreview(ROUND_ID);
  previewOutcome = { kind: 'OK', items: preview.items.map((i) => ({ shipmentId: i.shipmentId, net: i.net })), totals: preview.totals };
  log('A3 preview OK:', JSON.stringify(previewOutcome));
  if (!DRY_RUN) {
    if (preview.items.length !== lotIds.length || preview.items.some((i) => i.net !== EXPECTED_FREIGHT)) {
      fail(3, 'A3: preview thiếu lô hoặc lô thiếu tiền —', JSON.stringify(previewOutcome));
    }
    if (preview.totals.net !== EXPECTED_ROUND.amount || preview.totals.gross !== EXPECTED_ROUND_GROSS) {
      fail(3, 'A3: preview totals', preview.totals, '≠ round', EXPECTED_ROUND_GROSS);
    }
  }
} catch (error) {
  previewOutcome = { kind: 'BLOCKED', message: error instanceof ApiError ? error.message : String(error) };
  log('A3 preview BLOCKED:', JSON.stringify(previewOutcome));
  if (!DRY_RUN) fail(3, 'A3: preview vẫn chặn sau khóa lại — không phát hành.');
}

// ─── A4: governed re-issue — [Lưu] service, money law asserted inside ────────
if (!DRY_RUN && !alreadyRepaired) {
  try {
    const issued = await createConsolidatedDebitNote({
      shipmentIds: lotIds,
      actor,
      settlementRoundId: ROUND_ID,
    });
    log('A4 issued:', JSON.stringify(issued));
    if (issued.totalNet !== EXPECTED_ROUND.amount || issued.totalGross !== EXPECTED_ROUND_GROSS) {
      fail(3, 'A4: note mới', issued, '≠ round money', EXPECTED_ROUND_GROSS);
    }
  } catch (error) {
    fail(3, 'A4: phát hành lại bị chặn:', error instanceof ApiError ? `${error.statusCode} ${error.message}` : String(error));
  }
  await invalidateReportCaches();
  log('A4 invalidateReportCaches() done (route parity).');
} else if (alreadyRepaired) {
  log('A4 IDEMPOTENT-NOOP: note LIVE đủ tiền đã tồn tại — skip issue.');
}

// ─── Post-verify (fresh run + idempotent re-run alike) ───────────────────────
const docsNow = (await db.select().from(s.billingDocuments).where(and(
  eq(s.billingDocuments.settlementRoundId, ROUND_ID),
  eq(s.billingDocuments.type, 'DEBIT_NOTE'),
  isNull(s.billingDocuments.deletedAt),
)));
log('V1 doc rows for round 5:', JSON.stringify(docsNow.map((d) => ({
  id: d.id, status: d.debitNoteStatus, net: Number(d.totalNet), tax: Number(d.totalTax), gross: Number(d.totalGross),
}))));
const liveNow = docsNow.filter(docIsLive);
const fullLiveNote = liveNow.find((d) => Number(d.totalGross) === EXPECTED_ROUND_GROSS);

const claimsNow = await db.select({
  id: s.debitNoteLots.id, documentId: s.debitNoteLots.documentId, shipmentId: s.debitNoteLots.shipmentId,
  releasedAt: s.debitNoteLots.releasedAt, releaseReason: s.debitNoteLots.releaseReason,
}).from(s.debitNoteLots).where(inArray(s.debitNoteLots.shipmentId, lotIds));
log('V2 all lot claims:', JSON.stringify(claimsNow));
const liveClaimByLot = new Map(claimsNow.filter((c) => c.releasedAt == null).map((c) => [c.shipmentId, c.documentId]));

const allDocsNow = (await db.select({
  id: s.billingDocuments.id, status: s.billingDocuments.debitNoteStatus,
  deletedAt: s.billingDocuments.deletedAt, gross: s.billingDocuments.totalGross,
}).from(s.billingDocuments).where(eq(s.billingDocuments.type, 'DEBIT_NOTE')));
const liveGrossAfter = allDocsNow.filter(docIsLive).reduce((sum, d) => sum + Number(d.gross), 0);
log(`V3 books after: Tổng LIVE DEBIT_NOTE gross = ${liveGrossAfter} ₫ (delta +${liveGrossAfter - liveGross} ₫ so với baseline)`);

const expectedBooksDelta = alreadyRepaired ? 0 : EXPECTED_ROUND_GROSS; // re-run: baseline đã chứa note đủ tiền
const verdict = {
  roundId: ROUND_ID,
  expectedRoundGross: EXPECTED_ROUND_GROSS,
  canceledHalfNote: canceledDocs.map((d) => d.id),
  fullLiveNoteId: fullLiveNote?.id ?? null,
  fullLiveNoteGross: fullLiveNote ? Number(fullLiveNote.totalGross) : null,
  liveClaimsOnRoundLots: [...liveClaimByLot.entries()].map(([shipmentId, documentId]) => ({ shipmentId, documentId })),
  activeLocksFrozenFull: freezeCheck.every((c) => c.freightAuto === EXPECTED_FREIGHT && c.receivableTotal === EXPECTED_FREIGHT),
  previewOutcome: previewOutcome?.kind ?? null,
  booksBefore: liveGross,
  booksAfter: liveGrossAfter,
  booksDelta: liveGrossAfter - liveGross,
};
log('VERDICT', JSON.stringify(verdict, null, 2));
const ok = !DRY_RUN
  && fullLiveNote != null
  && verdict.canceledHalfNote.length >= 1
  && verdict.liveClaimsOnRoundLots.length === lotIds.length
  && verdict.liveClaimsOnRoundLots.every((c) => c.documentId === fullLiveNote.id)
  && verdict.activeLocksFrozenFull
  && verdict.previewOutcome === 'OK'
  && verdict.booksDelta === expectedBooksDelta;
log(ok ? '✅ RUNBOOK OK — round 5 RE-POST hoàn tất: note ≡ đợt 8.536.320 ₫.' : '❌ RUNBOOK INCOMPLETE — xem VERDICT.');
process.exit(ok ? 0 : 4);
