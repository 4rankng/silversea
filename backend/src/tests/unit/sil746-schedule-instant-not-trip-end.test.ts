/**
 * SIL-746 (id 866) — after Phát lệnh, the /dispatch LỊCH TRÌNH column showed
 * the trip's estimated plannedEndAt (16:30) instead of the saved appointment
 * (14:30), while /dispatch-detail and the drawer kept 14:30. The trip end is
 * a synthesized estimate (+2h from the issue dialog), never an entered giờ
 * hẹn, so the appointment-group instant must follow the /dispatch-detail law:
 * stored fulfillment plannedEndAt (explicit dispatch override, card 343) →
 * container customerAppointmentAt. Pins the WIRING in the unit-only tree
 * (no db, no app boot — 2026-10-19 owner ruling; the db-bound loaders cannot
 * run here) across every sibling that card 343 wired the trip end into:
 *   - loadShipmentListAppointmentGroups (master-plan LỊCH TRÌNH cell),
 *   - loadShipmentListContainerPortGroups (cảng nâng/hạ day grouping),
 *   - the CUS workspace buildAppointmentGroups (Lịch trình & điều xe),
 *   - the AssignmentRow read (no trip end column left to leak back in).
 * CARD-343's own verified behavior (dispatch override propagates over the
 * stale appointment, no trip involved) is untouched by this law.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const listSummariesSource = readFileSync(join(here, '../../services/shipment-queries/list-summaries.ts'), 'utf8');
const containerAggregatesSource = readFileSync(join(here, '../../services/shipment-queries/container-aggregates.ts'), 'utf8');
const buildersSource = readFileSync(join(here, '../../services/cus-workspace-builders.service.ts'), 'utf8');
const readsSource = readFileSync(join(here, '../../services/cus-shipment-workspace-reads.service.ts'), 'utf8');

const loaderSource = (source: string, fnName: string): string => {
  const start = source.indexOf(`export async function ${fnName}(`);
  assert.ok(start >= 0, `${fnName} must exist`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
};

describe('SIL-746 the appointment-group instant never reads the trip end', () => {
  test('master-plan appointment groups follow override → appointment, without the trips join', () => {
    const source = loaderSource(listSummariesSource, 'loadShipmentListAppointmentGroups');
    assert.match(source, /const effectiveAt = row\.fulfillmentPlannedEndAt \?\? row\.customerAppointmentAt;/);
    assert.doesNotMatch(source, /tripPlannedEndAt/);
    assert.doesNotMatch(source, /leftJoin\(s\.trips/);
  });

  test('cảng nâng/hạ day grouping follows the same instant law', () => {
    const source = loaderSource(containerAggregatesSource, 'loadShipmentListContainerPortGroups');
    assert.match(source, /const effectiveAt = row\.fulfillmentPlannedEndAt \?\? row\.customerAppointmentAt;/);
    assert.doesNotMatch(source, /tripPlannedEndAt/);
    assert.doesNotMatch(source, /leftJoin\(s\.trips/);
  });

  test('CUS workspace appointment groups drop the trip end from the chain', () => {
    const groupsFn = buildersSource.slice(
      buildersSource.indexOf('function buildAppointmentGroups('),
      buildersSource.indexOf('function readSiteSnapshotSite('),
    );
    assert.match(groupsFn, /const effectiveAt = assignment\?\.plannedEndAt \?\? container\.customerAppointmentAt;/);
    assert.doesNotMatch(groupsFn, /tripPlannedEndAt/);
  });

  test('AssignmentRow no longer carries trips.plannedEndAt for the group chain', () => {
    assert.doesNotMatch(readsSource, /tripPlannedEndAt/);
  });
});
