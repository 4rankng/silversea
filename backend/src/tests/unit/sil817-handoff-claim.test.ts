/**
 * SIL-817 AC3b (id 946, QA fail 14/11 on build c230df97) — Phát lệnh must
 * never strand the lot's dispatch handoff without a handler. QA repro
 * (staging): dispatcher issued the order for lô R3M-D2-A (shipment 765) —
 * 201, request carried no handler field — and the intake handoff #668 stayed
 * UNSEEN with handlerId NULL, the exact "chưa có người phụ trách" strand the
 * stuck-trips watchlist flags and the root of the PROD trip-13 wall.
 *
 * The law (auto-assign per the ticket's preferred option): the ISSUE
 * transaction claims the shipment's ACTIVE (UNSEEN/SEEN) handler-NULL
 * handoff for the issuing dispatcher. Clerk intake broadcasts stay
 * handler-less by design; an owned handoff keeps its owner; ACCEPTED/
 * REJECTED rows are history. Rides the same tx as the trip write.
 *
 * DB-free per the BE unit-only ruling (2026-10-19) — the tx seam is pinned
 * on the source, the row law on the claim function, per the SIL-638 TC6
 * source-pin precedent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): string =>
  readFileSync(path.join(here, '../../services', name), 'utf8');

describe('SIL-817 AC3b — the claim row law (dispatch-handoff.service.ts)', () => {
  const source = read('dispatch-handoff.service.ts');

  it('claims only the ACTIVE handoff of the shipment — never resolved history', () => {
    assert.match(source, /export async function claimHandlerlessDispatchHandoffInTx\(/);
    assert.match(
      source,
      /claimHandlerlessDispatchHandoffInTx[\s\S]*?eq\(s\.dispatchHandoffs\.shipmentId, shipmentId\),[\s\S]*?s\.dispatchHandoffs\.status\} IN \('UNSEEN', 'SEEN'\)/,
    );
  });

  it('claims only a handler-NULL row — an owned handoff keeps its owner', () => {
    // Filter on the read…
    assert.match(
      source,
      /claimHandlerlessDispatchHandoffInTx[\s\S]*?isNull\(s\.dispatchHandoffs\.handlerId\),[\s\S]*?\.for\('update'\)/,
    );
    // …and re-guard the write so a concurrent claim cannot double-own.
    assert.match(
      source,
      /\.where\(and\(eq\(s\.dispatchHandoffs\.id, active\.id\), isNull\(s\.dispatchHandoffs\.handlerId\)\)\)/,
    );
  });

  it('follows the markSeen optimistic-lock convention: version bump + updatedAt', () => {
    const fn = source.match(/export async function claimHandlerlessDispatchHandoffInTx[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(fn, /version: sql`\$\{s\.dispatchHandoffs\.version\} \+ 1`/);
    assert.match(fn, /updatedAt: new Date\(\)/);
    assert.match(fn, /\.for\('update'\)/);
  });
});

describe('SIL-817 AC3b — the issue path claims the handoff (dispatch-planning-commands.service.ts)', () => {
  const source = read('dispatch-planning-commands.service.ts');

  it('issueOrderCreateOrUpdate claims with the issuing dispatcher in the SAME tx', () => {
    assert.match(
      source,
      /await claimHandlerlessDispatchHandoffInTx\(tx, shipment\.id, input\.actor\.userId\);/,
    );
  });

  it('the claim lands after the order write commits shape (post status transition, pre return)', () => {
    const anchor = source.match(
      /await transitionShipmentStatus\([\s\S]*?'DISPATCHED',[\s\S]*?tx,\s*\n\s*\);[\s\S]*?await claimHandlerlessDispatchHandoffInTx\(tx, shipment\.id, input\.actor\.userId\);/,
    );
    assert.ok(anchor, 'the claim must follow the DISPATCHED transition inside issueOrderCreateOrUpdate');
  });

  it('the cascade siblings claim through the same core (issueOrderCreateOrUpdate recursion)', () => {
    // The ghép-trả-ĐV cascade calls issueOrderCreateOrUpdate per sibling —
    // one call site means every issued lot of the group claims its own
    // handoff, not just the primary.
    assert.match(
      source,
      /issueOrderCreateOrUpdate\(tx, \{[\s\S]*?cascadeSiblings: false \}\);/,
    );
  });
});
