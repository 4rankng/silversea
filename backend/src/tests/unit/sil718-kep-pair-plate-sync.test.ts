/**
 * SIL-718 — Kẹp pair plate mismatch guard (2 chân Kẹp phải cùng xe).
 *
 * Pinned here (BE unit-only ruling 2026-10-19):
 *  - KEP_PAIR_SPLIT_WARNING_MESSAGE and KEP_PAIR_SPLIT_WARNING_CODE exported
 *  - atomicDispatchPlanEditSchema accepts kepPairSplitConfirmed
 *  - Static wiring verification for dispatch-planning routes and service
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  KEP_PAIR_SPLIT_WARNING_CODE,
  KEP_PAIR_SPLIT_WARNING_MESSAGE,
} from '../../services/trip-pair-rules.service';
import { atomicDispatchPlanEditSchema } from '@tingting/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('SIL-718 Kẹp pair plate mismatch rules & contracts', () => {
  it('exports standard split warning message and code', () => {
    assert.equal(KEP_PAIR_SPLIT_WARNING_CODE, 'KEP_PAIR_SPLIT_WARNING');
    assert.equal(
      KEP_PAIR_SPLIT_WARNING_MESSAGE,
      '2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách.',
    );
  });

  it('atomicDispatchPlanEditSchema accepts kepPairSplitConfirmed flag', () => {
    const valid = atomicDispatchPlanEditSchema.safeParse({
      expectedFulfillmentVersion: 1,
      expectedShipmentVersion: 1,
      carrierType: 'OWN',
      truckId: 154,
      classification: 'DOUBLE',
      plannedRevenue: 1000000,
      plannedCarrierCost: 800000,
      kepPairSplitConfirmed: true,
    });
    assert.equal(valid.success, true);
    if (valid.success) {
      assert.equal(valid.data.kepPairSplitConfirmed, true);
    }
  });

  it('dispatch-planning routes forwards kepPairSplitConfirmed to service', () => {
    const routeSource = readFileSync(
      path.resolve(__dirname, '../../routes/shipments/dispatch-planning.routes.ts'),
      'utf-8',
    );
    assert.ok(
      routeSource.includes('kepPairSplitConfirmed: parsed.data.kepPairSplitConfirmed === true'),
      'routes must extract and forward kepPairSplitConfirmed',
    );
  });

  it('dispatch-planning detail-plan service checks Kẹp pair plate mismatch and throws KEP_PAIR_SPLIT_WARNING', () => {
    const serviceSource = readFileSync(
      path.resolve(__dirname, '../../services/dispatch-planning-detail-plan.service.ts'),
      'utf-8',
    );
    assert.ok(
      serviceSource.includes('KEP_PAIR_SPLIT_WARNING_MESSAGE'),
      'service must reference KEP_PAIR_SPLIT_WARNING_MESSAGE',
    );
    assert.ok(
      serviceSource.includes('KEP_PAIR_SPLIT_WARNING_CODE'),
      'service must reference KEP_PAIR_SPLIT_WARNING_CODE',
    );
    assert.ok(
      serviceSource.includes('!input.kepPairSplitConfirmed'),
      'service must gate on kepPairSplitConfirmed',
    );
  });
});
