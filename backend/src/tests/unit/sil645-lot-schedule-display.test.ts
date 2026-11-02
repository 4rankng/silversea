/**
 * SIL-645 (id 750) — the lot row's schedule giờ reached THREE surfaces, but
 * two of them dropped it: the Chi tiết lô hàng ledger cell printed the
 * date-only expectedDeliveryDate (ignoring the lot's stored
 * closingAt/plannedReturnAt and the SIL-610 derived "Giờ chạy"), and the
 * Kế hoạch Chi tiết Xe wire had no path to the derived instant for legacy
 * lots. Pins the WIRING in the unit-only tree (no db, no app boot —
 * 2026-10-19 owner ruling; the db-bound projections cannot run here):
 *   - the ledger flat row carries derivedScheduleAt from the SAME support
 *     trip map the overview uses (no new query);
 *   - the detail-plan runAt coalesce rides the derivation after the stored
 *     instants, sharing ONE law with the overview (deriveLegacyScheduleInstant);
 *   - the fulfillment-less branch keeps the union shape with structurally
 *     null columns;
 *   - the shared flat-row schema exposes the optional field.
 * The derivation's own behavior (same-day-ICT-only, stored-wins) is pinned
 * by cus-legacy-lcl-schedule-instant.test.ts (SIL-610) and is not repeated.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const readsSource = readFileSync(join(here, '../../services/cus-shipment-workspace-reads.service.ts'), 'utf8');
const detailPlanSource = readFileSync(join(here, '../../services/dispatch-planning-detail-plan-read.service.ts'), 'utf8');
const fulfillmentLessSource = readFileSync(join(here, '../../services/dispatch-detail-plan-fulfillment-less.ts'), 'utf8');
// Repo-root shared/ is FOUR levels up from backend/src/tests/unit/
// (backend/src/tests/unit → backend/src/tests → backend/src → backend → root).
const sharedSchemaSource = readFileSync(join(here, '../../../../shared/src/schemas/cus-shipment-workspace.ts'), 'utf8');

const lotRowSource = () => readsSource.slice(
  readsSource.indexOf('function buildLotFlatRow('),
  readsSource.indexOf('export async function listCusShipmentContainers('),
);

describe('SIL-645 ledger flat row carries the lot schedule instant', () => {
  test('buildLotFlatRow derives derivedScheduleAt from the already-loaded support trips', () => {
    const source = lotRowSource();
    assert.match(source, /derivedScheduleAt: deriveLegacyScheduleInstant\(/);
    // The lot's live-trip rows ride the SAME map loadSupportRows populated
    // for the overview — the read must not add a query.
    assert.match(source, /support\.tripsByShipment\.get\(row\.shipment\.id\)/);
  });
});

describe('SIL-645 detail-plan wire rides the derived lot instant', () => {
  test('runAt coalesce extends the stored instants with the shared derivation', () => {
    assert.match(
      detailPlanSource,
      /import \{ deriveLegacyScheduleInstant \} from '\.\/cus-workspace-mapping\.service';/,
    );
    assert.match(detailPlanSource, /const storedRunAt = row\.customerAppointmentAt \?\? row\.closingAt \?\? row\.plannedReturnAt;/);
    assert.match(detailPlanSource, /storedRunAt \?\? \(derivedRunAt \? new Date\(derivedRunAt\) : null\)/);
  });

  test('the derivation gates on the LCL mode before reading the lot columns', () => {
    assert.match(detailPlanSource, /storedRunAt == null && row\.cargoMode === 'LCL'/);
  });

  test('fulfillment-less branch keeps the union shape with structurally null trip columns', () => {
    assert.match(fulfillmentLessSource, /tripPlannedStartAt: sql<null>`null`/);
    assert.match(fulfillmentLessSource, /tripPlannedEndAt: sql<null>`null`/);
  });
});

describe('SIL-645 shared flat-row schema exposes the optional instant', () => {
  test('derivedScheduleAt is nullable and optional (older payloads keep rendering date-only)', () => {
    assert.match(sharedSchemaSource, /derivedScheduleAt: z\.iso\.datetime\(\)\.nullable\(\)\.optional\(\)/);
  });
});
