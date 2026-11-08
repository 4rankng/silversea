/**
 * SIL-727 — re-exporting a PREVIOUSLY-locked lot must never dead-end in
 * 'Không tìm thấy tài liệu'. QA 08/11 (staging build 9f900f39, hoapt):
 *  · R3M-KR1 → POST /api/shipments/debit-notes 201 replayed the ca0e72b9-wave
 *    idempotency record `{id:13}` whose billing_documents row no longer
 *    existed → the export GET 404'd 'Không tìm thấy tài liệu' (documentId 13).
 *  · R3P-KR1 → POST 409 'đã được xuất Debit Note' with NO note #named.
 * Fresh lots exported fine — only the stale-replay shape broke.
 *
 * Laws pinned here (source scan, BE unit-only owner ruling — the service
 * imports the db):
 *  1. Both creators extract `issueInTx` and hand it to runIdempotent as
 *     `create`, so the replay repair can re-run the SAME authoritative path.
 *  2. After a replay, the returned id must point at a LIVE document
 *     (exists, deletedAt IS NULL); otherwise the creator re-issues through
 *     db.transaction(issueInTx). One-note-per-lot stays intact — the create
 *     path's own overlap guard (now naming `đã xuất Debit Note #N`) + the
 *     advisory claim locks serialize concurrent re-issues.
 *  3. billingDocumentIsLive checks existence AND soft-delete.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, '../../services/shipment-cost-lock.service.ts'),
  'utf8',
);

function creator(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}`);
  assert.ok(start > 0, `${name} must exist`);
  // Line-start boundary: the bodies' comments legitimately contain the word
  // 'export ' (FB-094 'file export and…', SIL-727 'the export GET would 404'),
  // so a naive indexOf('export ') would truncate mid-body.
  const after = SOURCE.slice(start + 10);
  const endRel = after.search(/^export /m);
  return endRel === -1 ? after : after.slice(0, endRel);
}

describe('SIL-727 — a replayed debit note id must be a LIVE document', () => {
  for (const name of ['createDebitNoteFromCostLock', 'createConsolidatedDebitNote'] as const) {
    it(`${name} extracts issueInTx and repairs stale replays by re-issuing`, () => {
      const body = creator(name);
      assert.match(body, /const issueInTx = async \(tx: Tx\): Promise<\{ id: number \}> => \{/,
        'the authoritative create path must be an extractable closure');
      assert.match(body, /create: issueInTx,/, 'runIdempotent must run the same closure');
      assert.match(
        body,
        /if \(replayed && !\(await billingDocumentIsLive\(result\.id\)\)\) \{\s*\n\s*return db\.transaction\(issueInTx\);\s*\n\s*\}/,
        'a replayed dead id must re-issue through the same path instead of returning it',
      );
    });
  }

  it('billingDocumentIsLive treats soft-deleted (and purged) documents as dead', () => {
    const helper = SOURCE.slice(
      SOURCE.indexOf('async function billingDocumentIsLive'),
      SOURCE.indexOf('export async function createDebitNoteFromCostLock'),
    );
    assert.match(helper, /isNull\(s\.billingDocuments\.deletedAt\)/);
    assert.match(helper, /return row != null;/);
  });

  it('the repair rides ONLY the replay branch — a fresh create returns untouched', () => {
    const body = creator('createDebitNoteFromCostLock');
    const repairIdx = body.indexOf('if (replayed && !(await billingDocumentIsLive(result.id))) {');
    const returnIdx = body.indexOf('return result;');
    assert.ok(repairIdx > 0 && returnIdx > repairIdx, 'the live path returns the run result after the repair guard');
  });
});
