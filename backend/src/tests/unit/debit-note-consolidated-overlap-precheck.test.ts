// SIL-693 r2 — the consolidated Debit Note export must answer the overlap
// law BEFORE the idempotency actor-collision can mask it. The server-derived
// key `consolidated:<customerId>:<hash(selection)>` ignores client headers,
// so a selection ANY user once exported replays THEIR idempotency record and
// runIdempotent throws 409 'Khóa giao dịch này thuộc về người thực hiện
// khác' before the in-create overlap guard ever runs — the operator then saw
// the collision line (or, on the FE, the generic toast) instead of 'đã nằm
// trong Debit Note'.
//
// Pure unit test (BE unit-only owner ruling): createConsolidatedDebitNote
// lives on the db-importing cost-lock service, so the defect class is pinned
// by source scan — the pre-check sits between the lock check and
// runIdempotent, the guard keeps its overlappingLotCodes 409 detail, the
// in-transaction guard stays authoritative, and runIdempotent's own law is
// untouched. The live behavior (overlap 409 first, fresh selection still
// issues) is driven on the local stack: qa/2026-11-06-lane-693r2-688r2/.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SERVICE_DIR = path.resolve(import.meta.dirname, '../../services');
const SOURCE = readFileSync(path.join(SERVICE_DIR, 'shipment-cost-lock.service.ts'), 'utf8');
const IDEMPOTENCY = readFileSync(path.join(SERVICE_DIR, 'idempotency.service.ts'), 'utf8');

/** The createConsolidatedDebitNote function body, up to the next top-level
 *  export — the only surface this lane's law touches. Line-start boundary:
 *  the body's comments contain the word 'export ' (SIL-727), so a naive
 *  indexOf('export ') would truncate mid-body. */
const consolidated = (() => {
  const start = SOURCE.indexOf('export async function createConsolidatedDebitNote');
  const after = SOURCE.slice(start + 10);
  const endRel = after.search(/^export /m);
  return endRel === -1 ? after : after.slice(0, endRel);
})();

describe('consolidated debit note — overlap pre-check before runIdempotent (SIL-693 r2)', () => {
  it('the pre-check runs on the pool BEFORE the idempotency key is derived / runIdempotent is called', () => {
    const precheck = consolidated.indexOf('await assertLotsNotInIssuedDebitNote(db, shipmentIds);');
    const keyDerive = consolidated.indexOf('const idempotencyKey = `consolidated:');
    const runCall = consolidated.indexOf('await runIdempotent({');
    assert.ok(precheck > 0, 'the consolidated path must carry the db-level overlap pre-check');
    assert.ok(keyDerive > precheck, 'the derived key must come after the overlap pre-check');
    assert.ok(runCall > keyDerive, 'runIdempotent must come after the overlap pre-check');
  });

  it('the in-transaction guard stays authoritative inside the idempotent create', () => {
    // SIL-727 renamed the create closure to `issueInTx` (extracted so the
    // stale-replay repair can re-run it); the guard stays its first statement.
    const createBody = consolidated.slice(consolidated.indexOf('const issueInTx'));
    assert.match(
      createBody,
      /await assertLotsNotInIssuedDebitNote\(tx, shipmentIds\);/,
      'the tx-level guard must remain the first statement of the create path',
    );
  });

  it('the guard still answers 409 with overlappingLotCodes AND names the holding note (#id, SIL-727)', () => {
    assert.match(
      SOURCE,
      /throw new ApiError\(\s*409,\s*`Các lô \$\{overlappingLotCodes\.join\(', '\)\} đã xuất Debit Note \$\{overlappingDocumentIds\.map\(\(id\) => `#\$\{id\}`\)\.join\(', '\)\}\. Mỗi lô đã khóa chỉ xuất trong một Debit Note duy nhất\.`,\s*undefined,\s*\{ overlappingLotCodes, overlappingDocumentIds \},\s*\)/,
    );
  });

  it('the per-lot export path is unchanged — its guard lives inside create', () => {
    const perLot = SOURCE.slice(
      SOURCE.indexOf('export async function createDebitNoteFromCostLock'),
      SOURCE.indexOf('export ', SOURCE.indexOf('export async function createDebitNoteFromCostLock') + 10),
    );
    assert.match(perLot, /await assertLotsNotInIssuedDebitNote\(tx, \[input\.shipmentId\]\);/);
    assert.doesNotMatch(perLot, /assertLotsNotInIssuedDebitNote\(db,/);
  });
});

describe('runIdempotent law untouched (SIL-693 r2 boundary)', () => {
  it('the actor-collision and payload-mismatch 409s keep their exact lines', () => {
    assert.match(IDEMPOTENCY, /'Khóa giao dịch này thuộc về người thực hiện khác — vui lòng dùng mã giao dịch mới\.'/);
    assert.match(IDEMPOTENCY, /'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới\.'/);
  });

  it('the pre-check cannot reject a fresh selection — the guard rejects only on live (unreleased) debit-note claims', () => {
    const guard = SOURCE.slice(
      SOURCE.indexOf('async function assertLotsNotInIssuedDebitNote'),
      SOURCE.indexOf('/** Freeze gate', 1),
    );
    // The only throw in the guard fires after the overlap query returned rows
    // (releasedAt IS NULL) — a fresh selection overlaps nothing and proceeds
    // to runIdempotent unchanged, so a first export still issues (201).
    const throws = [...guard.matchAll(/throw new ApiError/g)].map((m) => m.index ?? 0);
    const overlapQuery = guard.indexOf('isNull(s.debitNoteLots.releasedAt)');
    assert.ok(overlapQuery > 0, 'the guard must scope its check to unreleased claims');
    for (const at of throws) {
      assert.ok(at > overlapQuery, 'every guard rejection must follow the unreleased-claim query');
    }
  });
});
