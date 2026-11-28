/**
 * SIL-1241 — "Moóc cho chuyến (ghi đè)": the per-trip trailer override picked
 * in the plan editor's 'Phát lệnh cho tài xế' section must survive 'Lưu thay
 * đổi'. The observed bug: the plan PATCH body carried no trailer field at
 * all, so the value vanished on reopen and bulk 'Phát lệnh hàng loạt' still
 * rode the tractor's 20FT coupling into 'Rơ-moóc không phù hợp với loại
 * container.' Contract: the plan schema carries plannedTrailerId (omit =
 * unchanged, null = clear), the fulfillment stores it, the plan-row read
 * surfaces it, and issuance resolves issue-pick ?? stored override ??
 * coupling. The transaction paths need a live DB, which the BE unit tree
 * never touches — the write/read wiring is pinned by source scan (house
 * pattern: sil1138).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { atomicDispatchPlanEditSchema } from '@tingting/shared';

const serviceSrc = readFileSync(path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan.service.ts'), 'utf8');
const readSrc = readFileSync(path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan-read.service.ts'), 'utf8');
const commandSrc = readFileSync(path.resolve(import.meta.dirname, '../../services/dispatch-planning-commands.service.ts'), 'utf8');
const routeSrc = readFileSync(path.resolve(import.meta.dirname, '../../routes/shipments/dispatch-planning.routes.ts'), 'utf8');
const schemaSrc = readFileSync(path.resolve(import.meta.dirname, '../../db/schema/shipments.ts'), 'utf8');

const baseBody = {
  expectedFulfillmentVersion: 1,
  expectedShipmentVersion: 1,
  carrierType: 'OWN' as const,
  truckId: 12,
  plannedRevenue: null,
  plannedCarrierCost: null,
};

describe('SIL-1241 — plan trailer override persistence', () => {
  it('atomicDispatchPlanEditSchema accepts plannedTrailerId on the strict plan contract', () => {
    const parsed = atomicDispatchPlanEditSchema.safeParse({
      ...baseBody,
      plannedTrailerId: 7,
    });
    assert.equal(parsed.success, true);
  });

  it('an omitted plannedTrailerId stays out of the parsed body (undefined = unchanged), null clears', () => {
    const omitted = atomicDispatchPlanEditSchema.parse(baseBody);
    assert.equal('plannedTrailerId' in omitted, false);
    const cleared = atomicDispatchPlanEditSchema.parse({ ...baseBody, plannedTrailerId: null });
    assert.equal(cleared.plannedTrailerId, null);
  });

  it('a non-positive trailer id is rejected', () => {
    assert.equal(atomicDispatchPlanEditSchema.safeParse({ ...baseBody, plannedTrailerId: 0 }).success, false);
    assert.equal(atomicDispatchPlanEditSchema.safeParse({ ...baseBody, plannedTrailerId: -1 }).success, false);
  });

  it('the fulfillment persists the override and the plan-row read surfaces it (wiring)', () => {
    // Write path — the touch-gated update set.
    assert.match(serviceSrc, /\.\.\.\(input\.plannedTrailerId !== undefined \? \{ plannedTrailerId: input\.plannedTrailerId \} : \{\}\)/);
    // Read path — the row's dispatch carries the stored override (dialog reseed).
    assert.match(readSrc, /plannedTrailerId: row\.plannedTrailerId \?\? null/);
    // Issuance resolves issue-pick ?? stored override ?? coupling.
    assert.match(commandSrc, /input\.trailerId !== undefined \? input\.trailerId : fulfillment\.plannedTrailerId/);
    // Route passes the key through the strict schema.
    assert.match(routeSrc, /plannedTrailerId: parsed\.data\.plannedTrailerId/);
    // Column exists on the fulfillment table + the additive migration ships.
    assert.match(schemaSrc, /plannedTrailerId: integer\('planned_trailer_id'\)/);
    const migration = readFileSync(path.resolve(import.meta.dirname, '../../../drizzle/20261128120000_sil1241_plan_trailer_override.sql'), 'utf8');
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "planned_trailer_id" integer/);
  });
});
