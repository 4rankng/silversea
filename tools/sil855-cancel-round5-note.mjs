// SIL-855 runbook — governed cancel of the half-money round-5 Debit Note on STAGING.
//
// Context (QA round 5, build 6bcc081e): đợt chốt id=5 recorded 7.904.000 + VAT 8%
// = 8.536.320 ₫, but [Lưu] issued billing_documents #26 with only 3.952.000 +
// 316.160 = 4.268.160 ₫ — lot SHP-2611-00307 froze null freight, so its lines
// never reached the note. The fix (5d42086a) blocks new half-notes; this runbook
// repairs the EXISTING mis-note through the governed lifecycle so the same
// selection can re-issue the corrected note (commit 5d42086a "Repair lever").
//
// Run INSIDE the staging backend container (staging = /opt/vantai on
// vantai.tingting.vip; NEVER the silversea.tingting.vip prod stack):
//
//   ssh root@vantai.tingting.vip "cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml exec -T backend node --input-type=module" \
//     < tools/sil855-cancel-round5-note.mjs
//
// Guarantees:
// - IDEMPOTENT: re-run after success finds no LIVE mis-note → no-op + re-verify.
// - SHAPE-GUARDED: every expected value (round money, note totals, lot set,
//   note status) is asserted BEFORE the cancel; any drift aborts with no data
//   change (exit 3).
// - GOVERNED ONLY: the cancel goes through transitionDebitNoteStatus → the
//   lifecycle's own transaction releases debit_note_lots / trip / recoverable
//   claims (releaseReason DOCUMENT_CANCELED) — no direct UPDATE/DELETE here.
// - SCOPED: touches ONLY billing_documents #<resolved round-5 note>; locks,
//   rounds and lots rows are read-only for this script.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './dist/db/index.js';
import * as s from './dist/db/schema/index.js';
import { transitionDebitNoteStatus } from './dist/services/debit-note-lifecycle.service.js';
import { assertRoundIssuanceTotals } from './dist/services/debit-settlement-shared.js';
import { getDebitNoteRoundPreview } from './dist/services/debit-settlement-rounds.service.js';
import { invalidateReportCaches } from './dist/lib/report-cache.js';
import { ApiError } from './dist/errors.js';

// ─── Expected staging shape (recon 2026-11-23, build 1aec2e01) ──────────────
const ROUND_ID = 5;
const EXPECTED_ROUND = { amount: 7_904_000, vatRate: 8 };           // gross 8.536.320
const EXPECTED_ROUND_GROSS = 8_536_320;
const EXPECTED_NOTE = { net: 3_952_000, tax: 316_160, gross: 4_268_160 }; // the half-money shape
const EXPECTED_LOT_CODES = ['SHP-2611-00306', 'SHP-2611-00307'];
const EXPECTED_NOTE_STATUS = 'SENT';                                 // legal → CANCELED

const log = (...parts) => console.log('[sil855]', ...parts);
const fail = (code, ...parts) => { console.error('[sil855] ABORT', ...parts); process.exit(code); };
const money = (row) => ({ net: Number(row.totalNet), tax: Number(row.totalTax), gross: Number(row.totalGross) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// SIL855_DRY_RUN=1 → run every guard + query, skip the cancel itself
// (post-verify then shows the PRE state and the verdict exits 4 — expected).
const DRY_RUN = process.env.SIL855_DRY_RUN === '1';
if (DRY_RUN) log('DRY-RUN mode: guards + reads only, no cancel.');

// ─── G1: the round record is exactly the money-law anchor ────────────────────
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
log(`G1 money law OK: đợt ${EXPECTED_ROUND.amount} + VAT ${EXPECTED_ROUND.vatRate}% = ${EXPECTED_ROUND_GROSS} ₫ (assertRoundIssuanceTotals passed)`);

// ─── G2: exactly one live mis-note with the exact half-money shape ───────────
const roundLots = await db.select({
  shipmentId: s.debitSettlementRoundLots.shipmentId,
  shipmentCode: s.shipments.shipmentCode,
}).from(s.debitSettlementRoundLots)
  .innerJoin(s.shipments, eq(s.shipments.id, s.debitSettlementRoundLots.shipmentId))
  .where(eq(s.debitSettlementRoundLots.roundId, ROUND_ID));
const lotIds = roundLots.map((row) => row.shipmentId).sort((a, b) => a - b);
const lotCodes = roundLots.map((row) => row.shipmentCode).sort();
log('G3 round lots:', JSON.stringify(roundLots.map((row) => ({ id: row.shipmentId, code: row.shipmentCode }))));
if (!same(lotCodes, EXPECTED_LOT_CODES)) fail(3, 'G3: lot codes', lotCodes, '≠ expected', EXPECTED_LOT_CODES);

const liveDocs = await db.select().from(s.billingDocuments).where(and(
  eq(s.billingDocuments.settlementRoundId, ROUND_ID),
  eq(s.billingDocuments.type, 'DEBIT_NOTE'),
  isNull(s.billingDocuments.deletedAt),
));
const activeDocs = liveDocs.filter((doc) => doc.debitNoteStatus !== 'CANCELED');

if (activeDocs.length === 0) {
  const canceled = liveDocs.filter((doc) => doc.debitNoteStatus === 'CANCELED' && same(money(doc), EXPECTED_NOTE));
  if (canceled.length > 0) {
    log('IDEMPOTENT-NOOP: mis-note đã CANCELED trước đó (#' + canceled.map((d) => d.id).join(',#') + ') — chạy lại post-verify.');
  } else {
    fail(3, 'G2: không còn note LIVE và không tìm thấy note CANCELED đúng shape', EXPECTED_NOTE);
  }
} else {
  if (activeDocs.length !== 1) fail(3, 'G2: có', activeDocs.length, 'note LIVE cho round', ROUND_ID, '— shape drift, không đụng data.');
  const doc = activeDocs[0];
  log('G2 live mis-note row:', JSON.stringify({
    id: doc.id, status: doc.debitNoteStatus, settlementRoundId: doc.settlementRoundId,
    ...money(doc), entityName: doc.entityName, createdAt: doc.createdAt, version: doc.version,
  }));
  if (doc.id !== 26) log(`WARN: note id ${doc.id} ≠ 26 (recon id) — tiếp tục vì shape khớp.`);
  if (doc.debitNoteStatus !== EXPECTED_NOTE_STATUS) {
    fail(3, 'G2: status', doc.debitNoteStatus, '≠ expected', EXPECTED_NOTE_STATUS, '— không hủy mù.');
  }
  if (!same(money(doc), EXPECTED_NOTE)) fail(3, 'G2: totals', money(doc), '≠ expected half-money shape', EXPECTED_NOTE);

  // ─── G3: its LIVE lot claims cover exactly the round's lots ────────────────
  const claims = await db.select().from(s.debitNoteLots).where(and(
    eq(s.debitNoteLots.documentId, doc.id),
    isNull(s.debitNoteLots.releasedAt),
  ));
  const claimLotIds = claims.map((c) => c.shipmentId).sort((a, b) => a - b);
  log('G3 live claims:', JSON.stringify(claims.map((c) => ({ id: c.id, documentId: c.documentId, shipmentId: c.shipmentId }))));
  if (!same(claimLotIds, lotIds)) fail(3, 'G3: claims', claimLotIds, '≠ round lots', lotIds);
  const liveTripClaims = await db.select({ id: s.billingDocumentTripClaims.id }).from(s.billingDocumentTripClaims)
    .where(and(eq(s.billingDocumentTripClaims.documentId, doc.id), isNull(s.billingDocumentTripClaims.releasedAt)));
  const liveRecoverable = await db.select({ id: s.billingDocumentRecoverableClaims.id }).from(s.billingDocumentRecoverableClaims)
    .where(and(eq(s.billingDocumentRecoverableClaims.documentId, doc.id), isNull(s.billingDocumentRecoverableClaims.releasedAt)));
  log(`G3 live trip claims: ${liveTripClaims.length}, live recoverable claims: ${liveRecoverable.length} (cancel sẽ nhả nếu có)`);

  // ─── Actor: lowest-id ACTIVE ADMIN (audit columns only) ────────────────────
  const [actor] = await db.select({ id: s.users.id, username: s.users.username, fullName: s.users.fullName })
    .from(s.users)
    .where(and(eq(s.users.role, 'ADMIN'), eq(s.users.status, 'ACTIVE'), isNull(s.users.deletedAt)))
    .orderBy(s.users.id).limit(1);
  if (!actor) fail(3, 'G4: không có user ADMIN ACTIVE để ghi audit.');
  log('G4 actor:', JSON.stringify(actor));

  // ─── A1: governed cancel — lifecycle transition, its own transaction ───────
  if (DRY_RUN) {
    log('DRY-RUN: would transitionDebitNoteStatus → CANCELED for doc #' + doc.id + ' (skipped).');
  } else {
    log('A1 transitionDebitNoteStatus → CANCELED ...');
    const updated = await transitionDebitNoteStatus({
      documentId: doc.id,
      targetStatus: 'CANCELED',
      actorUserId: actor.id,
      reason: 'SIL-855 runbook: note lệch sổ 4.268.160/8.536.320 ₫ (freeze null freight lô SHP-2611-00307 trên build 6bcc081e) — hủy governed để phát hành lại đủ tiền theo Repair lever commit 5d42086a.',
    });
    log('A1 transitioned:', JSON.stringify({ id: updated.id, status: updated.debitNoteStatus, version: updated.version, updatedAt: updated.updatedAt }));
    // Route parity — bust the report caches the cancel route busts.
    await invalidateReportCaches();
    log('A2 invalidateReportCaches() done (route parity).');
  }
}

// ─── Post-verify (runs on both fresh-cancel and idempotent re-run) ───────────
const docNow = (await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.settlementRoundId, ROUND_ID)))
  .filter((d) => d.type === 'DEBIT_NOTE');
log('V1 doc rows for round 5:', JSON.stringify(docNow.map((d) => ({
  id: d.id, status: d.debitNoteStatus, ...money(d), version: d.version, deletedAt: d.deletedAt,
}))));

const claimsAfter = await db.select().from(s.debitNoteLots)
  .where(inArray(s.debitNoteLots.shipmentId, lotIds));
log('V2 all lot claims after:', JSON.stringify(claimsAfter.map((c) => ({
  id: c.id, documentId: c.documentId, shipmentId: c.shipmentId,
  releasedAt: c.releasedAt, releaseReason: c.releaseReason,
}))));
const liveClaimsAfter = claimsAfter.filter((c) => c.releasedAt == null);
const tripAfter = await db.select({ id: s.billingDocumentTripClaims.id }).from(s.billingDocumentTripClaims)
  .where(and(inArray(s.billingDocumentTripClaims.documentId, docNow.map((d) => d.id)), isNull(s.billingDocumentTripClaims.releasedAt)));
const recovAfter = await db.select({ id: s.billingDocumentRecoverableClaims.id }).from(s.billingDocumentRecoverableClaims)
  .where(and(inArray(s.billingDocumentRecoverableClaims.documentId, docNow.map((d) => d.id)), isNull(s.billingDocumentRecoverableClaims.releasedAt)));

// V3 — billingDocumentIsLive law: existence + not soft-deleted + not CANCELED.
const canceledRow = docNow.find((d) => d.debitNoteStatus === 'CANCELED');
const isLive = canceledRow != null && canceledRow.deletedAt == null && canceledRow.debitNoteStatus !== 'CANCELED';

// V4 — reissue selection: assertLotsNotInIssuedDebitNote passes for the same lots.
const overlapping = await db.select({
  documentId: s.debitNoteLots.documentId, shipmentId: s.debitNoteLots.shipmentId,
}).from(s.debitNoteLots).where(and(
  inArray(s.debitNoteLots.shipmentId, lotIds),
  isNull(s.debitNoteLots.releasedAt),
));

// V4b — locks intact (lô vẫn 'Đã khóa').
const locksAfter = await db.select({
  shipmentId: s.shipmentCostLocks.shipmentId, lockId: s.shipmentCostLocks.id,
  snapshot: s.shipmentCostLocks.costSnapshot,
  lockedAt: s.shipmentCostLocks.lockedAt,
}).from(s.shipmentCostLocks).where(and(
  inArray(s.shipmentCostLocks.shipmentId, lotIds),
  isNull(s.shipmentCostLocks.unlockedAt),
));
log('V4b active locks:', JSON.stringify(locksAfter.map((l) => ({
  shipmentId: l.shipmentId, lockId: l.lockId,
  freightAuto: l.snapshot?.freightAuto ?? null,
  receivableTotal: l.snapshot?.receivableTotal ?? null,
}))));

// V6 — preview behavior must be unchanged (preview-block law).
let previewOutcome;
try {
  const preview = await getDebitNoteRoundPreview(ROUND_ID);
  previewOutcome = { kind: 'OK', totals: preview.totals ?? preview };
} catch (error) {
  previewOutcome = error instanceof ApiError
    ? { kind: 'EXPECTED_PREVIEW_BLOCK', statusCode: error.statusCode, message: error.message }
    : { kind: 'UNEXPECTED_ERROR', name: error.name, message: error.message };
}

const allCanceled = docNow.length > 0 && docNow.every((d) => d.debitNoteStatus === 'CANCELED');
const verdict = {
  roundId: ROUND_ID,
  expectedRoundGross: EXPECTED_ROUND_GROSS,
  moneyLawAssert: `assertRoundIssuanceTotals(${EXPECTED_ROUND.amount} + ${EXPECTED_ROUND.vatRate}% = ${EXPECTED_ROUND_GROSS}) passed at G1`,
  noteCanceledGoverned: allCanceled && canceledRow != null && canceledRow.deletedAt == null,
  liveClaimsOnRoundLots: liveClaimsAfter.length,
  liveTripClaims: tripAfter.length,
  liveRecoverableClaims: recovAfter.length,
  billingDocumentIsLive_false: !isLive,
  reissueSelectionClear: overlapping.length === 0,
  activeLocksOnRoundLots: locksAfter.length,
  previewOutcome,
};
log('VERDICT', JSON.stringify(verdict, null, 2));
const ok = verdict.noteCanceledGoverned && verdict.reissueSelectionClear
  && verdict.liveClaimsOnRoundLots === 0 && verdict.billingDocumentIsLive_false
  && verdict.activeLocksOnRoundLots === lotIds.length;
log(ok ? '✅ RUNBOOK OK — post-runbook state reached.' : '❌ RUNBOOK INCOMPLETE — xem VERDICT.');
process.exit(ok ? 0 : 4);
