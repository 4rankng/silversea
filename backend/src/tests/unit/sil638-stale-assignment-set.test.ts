/**
 * SIL-638 (id 742) TC1 — the stale/hidden assignment set (QA 01/11:
 * SHP-2610-00267/-00322/-00323 vẫn chặn gán mới dù không thấy ở plan rows
 * Sep–Dec lẫn danh sách chuyến).
 *
 * Root cause: the rig-holder scans counted every fulfillment carrying the
 * plate with `canceledAt is null` — including fulfillments of DELETED lots
 * and lots in a non-operational status (DRAFT-family NEW/PENDING_DATE,
 * CANCELED). The plan grid (dispatch-planning-detail-plan-read.service) has
 * never shown those rows, so they blocked new assignments from the shadows.
 * The fix mirrors the read's visibility law:
 * `shipments.deleted_at is null` + `shipments.status in (READY_FOR_DISPATCH,
 * DISPATCHED, IN_TRANSIT, COMPLETED)`.
 *
 * DB-free per the BE unit-only ruling (2026-10-19): the shared law owner
 * (dispatch-plan-conflict-scan.service) is pinned by source-scan; the status
 * set is pinned as data.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// SIL-666 round-2: the status set moved beside the trip-claim SQL (the
// conflict-scan module is an import-cycle leaf and cannot be imported from
// the issue-time guard). Same exported data, new home.
import { OPERATIONAL_HOLDER_SHIPMENT_STATUSES } from '../../services/dispatch-resource-availability.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const scanSource = readFileSync(
  path.join(here, '../../services/dispatch-plan-conflict-scan.service.ts'),
  'utf8',
);

describe('TC1 — the hidden assignment set stops claiming rigs', () => {
  it('the operational status set mirrors the plan-row read filter verbatim', () => {
    assert.deepEqual(
      [...OPERATIONAL_HOLDER_SHIPMENT_STATUSES],
      ['READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED'],
    );
  });

  it('status set excludes the invisible statuses (NEW/PENDING_DATE/CANCELED)', () => {
    for (const invisible of ['NEW', 'PENDING_DATE', 'CANCELED']) {
      assert.ok(!OPERATIONAL_HOLDER_SHIPMENT_STATUSES.includes(invisible as never));
    }
  });

  it('BOTH holder scans filter deleted lots', () => {
    const fclBlock = scanSource.match(/export async function scanPlanRowHolders[\s\S]*?\n}\n/);
    const lclBlock = scanSource.match(/export async function scanLclPlanRowHolders[\s\S]*?\n}\n/);
    assert.ok(fclBlock && lclBlock, 'both scan functions must exist');
    for (const block of [fclBlock[0], lclBlock[0]]) {
      assert.match(block, /isNull\(s\.shipments\.deletedAt\)/);
    }
  });

  it('BOTH holder scans filter non-operational lot statuses', () => {
    const filterUses = scanSource.match(/inArray\(s\.shipments\.status, \[\.\.\.OPERATIONAL_HOLDER_SHIPMENT_STATUSES\]\)/g) ?? [];
    assert.ok(filterUses.length >= 2, `both scans must apply the status filter, found ${filterUses.length}`);
  });
});
