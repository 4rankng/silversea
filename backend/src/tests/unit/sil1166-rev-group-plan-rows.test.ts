/**
 * SIL-1166 (KB K3.79/K4.31) — sau gộp lô lẻ (rev-group) các dòng đã gộp phải
 * hiện tag "Lẻ · Ghép (k/N)" ở cột PHÂN LOẠI. The tag was missing because the
 * dispatch-detail plan rows returned lcl.group = null for rev-only lots (only
 * the COST group was selected/mapped) and the /shipments-detail flat row and
 * the chi tiết lô detail carried no group position/counts at all.
 * Pins the READ SHAPE wiring in the unit-only tree (no db, no app boot):
 *   - plan rows select revGroupId/revGroupOrder and map the REV group into
 *     lcl.group with dimension 'REV' (cost leads when both — W3A), its N a
 *     live-member count computed read-side;
 *   - the fulfillment-less branch keeps the union shape with the same fields;
 *   - the /shipments-detail lot row emits both dimensions' order + live count;
 *   - the chi tiết lô detail computes the member counts;
 *   - the shared flat-row schema exposes the optional fields.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const detailPlanSource = readFileSync(join(here, '../../services/dispatch-planning-detail-plan-read.service.ts'), 'utf8');
const fulfillmentLessSource = readFileSync(join(here, '../../services/dispatch-detail-plan-fulfillment-less.ts'), 'utf8');
const workspaceReadsSource = readFileSync(join(here, '../../services/cus-shipment-workspace-reads.service.ts'), 'utf8');
const shipmentDetailSource = readFileSync(join(here, '../../services/shipment-detail-reads.service.ts'), 'utf8');
// Repo-root shared/ is FOUR levels up from backend/src/tests/unit/.
const sharedSchemaSource = readFileSync(join(here, '../../../../shared/src/schemas/cus-shipment-workspace.ts'), 'utf8');

describe('SIL-1166 plan rows carry the rev-group facts', () => {
  test('the select reads revGroupId/revGroupOrder beside the cost group columns', () => {
    assert.match(detailPlanSource, /revGroupId: s\.shipments\.revGroupId,/);
    assert.match(detailPlanSource, /revGroupOrder: s\.shipments\.revGroupOrder,/);
    assert.match(detailPlanSource, /revVehicleClassName: revVehicleSizeClassTable\.name,/);
  });

  test('the rev group N is a live-member count computed read-side (soft-deleted excluded)', () => {
    assert.match(detailPlanSource, /const revGroupSizes = new Map\(/);
    assert.match(detailPlanSource, /inArray\(s\.shipments\.revGroupId, revGroupIds\), isNull\(s\.shipments\.deletedAt\)/);
  });

  test('lcl.group maps COST-first with dimension, then the rev fallback (W3A)', () => {
    assert.match(detailPlanSource, /dimension: 'COST' as const,/);
    assert.match(detailPlanSource, /: row\.revGroupId != null \? \{/);
    assert.match(detailPlanSource, /dimension: 'REV' as const,/);
    assert.match(detailPlanSource, /groupId: row\.revGroupId,/);
    assert.match(detailPlanSource, /memberCount: revGroupSizes\.get\(row\.revGroupId\) \?\? null,/);
  });

  test('the fulfillment-less branch keeps the union shape with the same rev fields', () => {
    assert.match(fulfillmentLessSource, /revGroupId: s\.shipments\.revGroupId,/);
    assert.match(fulfillmentLessSource, /revGroupOrder: s\.shipments\.revGroupOrder,/);
    assert.match(fulfillmentLessSource, /revVehicleClassName: revVehicleSizeClassTable\.name,/);
  });
});

describe('SIL-1166 /shipments-detail lot rows carry both dimensions' + ' ' + 'group position + count', () => {
  test('buildLotFlatRow emits revGroupOrder/revGroupMemberCount and the cost twins', () => {
    const lotRowSource = workspaceReadsSource.slice(
      workspaceReadsSource.indexOf('function buildLotFlatRow('),
      workspaceReadsSource.indexOf('export async function listCusShipmentContainers('),
    );
    assert.match(lotRowSource, /revGroupOrder: row\.shipment\.revGroupOrder \?\? null,/);
    assert.match(lotRowSource, /revGroupMemberCount: row\.shipment\.revGroupId != null \? groupSizes\.rev\.get\(row\.shipment\.revGroupId\) \?\? null : null,/);
    assert.match(lotRowSource, /costGroupOrder: row\.shipment\.costGroupOrder \?\? null,/);
    assert.match(lotRowSource, /costGroupMemberCount: row\.shipment\.costGroupId != null \? groupSizes\.cost\.get\(row\.shipment\.costGroupId\) \?\? null : null,/);
  });

  test('the counts are page-level live-member aggregates (soft-deleted excluded)', () => {
    assert.match(workspaceReadsSource, /inArray\(s\.shipments\.costGroupId, costGroupIds\), isNull\(s\.shipments\.deletedAt\)/);
    assert.match(workspaceReadsSource, /inArray\(s\.shipments\.revGroupId, revGroupIds\), isNull\(s\.shipments\.deletedAt\)/);
  });
});

describe('SIL-1166 chi tiết lô detail carries the member counts', () => {
  test('getShipmentDetail computes revGroupMemberCount/costGroupMemberCount live', () => {
    assert.match(shipmentDetailSource, /shipment\.revGroupId == null \? Promise\.resolve\(null\) : db\.select\(\{ memberCount: sql<number>`count\(\*\)` \}\)/);
    assert.match(shipmentDetailSource, /revGroupMemberCount,/);
    assert.match(shipmentDetailSource, /costGroupMemberCount,/);
  });
});

describe('SIL-1166 shared flat-row schema exposes the optional group facts', () => {
  test('revGroupOrder/revGroupMemberCount/costGroupOrder/costGroupMemberCount are nullable-optional', () => {
    assert.match(sharedSchemaSource, /revGroupOrder: z\.number\(\)\.int\(\)\.nullable\(\)\.optional\(\),/);
    assert.match(sharedSchemaSource, /revGroupMemberCount: z\.number\(\)\.int\(\)\.nullable\(\)\.optional\(\),/);
    assert.match(sharedSchemaSource, /costGroupOrder: z\.number\(\)\.int\(\)\.nullable\(\)\.optional\(\),/);
    assert.match(sharedSchemaSource, /costGroupMemberCount: z\.number\(\)\.int\(\)\.nullable\(\)\.optional\(\),/);
  });
});
