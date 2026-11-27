/**
 * SIL-1138 (QA 27/11) — "Chỉnh sửa điều phối": 'Tên/SĐT tài xế (nhà xe ngoài)'
 * typed in the 'Phát lệnh cho tài xế' section must survive 'Lưu thay đổi'.
 * The plan PATCH carries both keys (touch-gated: omitted = unchanged, ''/null
 * = clear), the fulfillment stores them, and the plan-row read surfaces them
 * so reopening the dialog keeps the contact (ticket expected: "lưu → mở lại
 * còn nguyên tên/SĐT"). The transaction paths need a live DB, which the BE
 * unit tree never touches — the write/read wiring is pinned by source scan
 * (house pattern: sil751/sil753).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { atomicDispatchPlanEditSchema } from '@tingting/shared';

const serviceSrc = readFileSync(path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan.service.ts'), 'utf8');
const readSrc = readFileSync(path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan-read.service.ts'), 'utf8');
const routeSrc = readFileSync(path.resolve(import.meta.dirname, '../../routes/shipments/dispatch-planning.routes.ts'), 'utf8');
const schemaSrc = readFileSync(path.resolve(import.meta.dirname, '../../db/schema/shipments.ts'), 'utf8');

const baseBody = {
  expectedFulfillmentVersion: 1,
  expectedShipmentVersion: 1,
  carrierType: 'EXTERNAL' as const,
  externalCarrierId: 9,
  plannedRevenue: null,
  plannedCarrierCost: null,
};

describe('SIL-1138 — plan external driver contact persistence', () => {
  it('atomicDispatchPlanEditSchema accepts the two driver keys on the strict plan contract', () => {
    const parsed = atomicDispatchPlanEditSchema.safeParse({
      ...baseBody,
      externalDriverName: 'QA Tài Xế R4',
      externalDriverPhone: '0901111222',
    });
    assert.equal(parsed.success, true);
  });

  it('omitted driver keys stay out of the parsed body (undefined = unchanged), "" clears', () => {
    const omitted = atomicDispatchPlanEditSchema.parse(baseBody);
    assert.equal('externalDriverName' in omitted, false);
    assert.equal('externalDriverPhone' in omitted, false);
    const cleared = atomicDispatchPlanEditSchema.parse({
      ...baseBody,
      externalDriverName: '',
      externalDriverPhone: null,
    });
    assert.equal(cleared.externalDriverName, '');
    assert.equal(cleared.externalDriverPhone, null);
  });

  it('the fulfillment persists the contact and the plan-row read falls back to it (wiring)', () => {
    // Write path — the touch-gated update set.
    assert.match(serviceSrc, /plannedExternalDriverName: input\.externalDriverName === '' \? null : input\.externalDriverName/);
    assert.match(serviceSrc, /plannedExternalDriverPhone: input\.externalDriverPhone === '' \? null : input\.externalDriverPhone/);
    // Read path — non-trip rows surface the stored contact (the QA round trip).
    assert.match(readSrc, /row\.plannedExternalDriverName \?\? null/);
    assert.match(readSrc, /row\.plannedExternalDriverPhone \?\? null/);
    // Route passes the keys through the strict schema.
    assert.match(routeSrc, /externalDriverName: parsed\.data\.externalDriverName/);
    assert.match(routeSrc, /externalDriverPhone: parsed\.data\.externalDriverPhone/);
    // Columns exist on the fulfillment table + the additive migration ships.
    assert.match(schemaSrc, /plannedExternalDriverName: varchar\('planned_external_driver_name'/);
    const migration = readFileSync(path.resolve(import.meta.dirname, '../../../drizzle/20261127180000_sil1138_plan_external_driver.sql'), 'utf8');
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "planned_external_driver_name" varchar\(100\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "planned_external_driver_phone" varchar\(20\)/);
  });
});
