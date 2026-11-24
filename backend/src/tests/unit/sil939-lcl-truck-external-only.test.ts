/**
 * SIL-939 — LCL xe tải 100% xe ngoài trong "Sửa điều phối" từng lô
 * (/dispatch-detail, KB §9.2 K9.9, FB-090 sourcing law).
 *
 * QA round 3 (staging c1150c99, lot R4B-A14-EMPTY2 / SHP-2611-00431): the
 * round-1/2 guard judged only lots carrying a COST class (Gán xe nhóm).
 * An ungrouped LCL lot carries its class on rev_vehicle_class_id instead —
 * that lot had cost_group_id NULL + cost_vehicle_class_id NULL, so the BE
 * plan save skipped the law, the FE dropdown stayed open, and the internal
 * fleet (SilverSea / 15E-016.26) saved again on a 5T lot. The law now
 * resolves the class COST-first, else the lot's own rev class — and every
 * write path of the per-lot dispatch plan (atomic plan save + legacy
 * /carrier + legacy /plate) runs the same refusal. Still outside the gate
 * (recorded boundary, needs an owner ruling before it becomes repeat fail
 * round 4): the Phát lệnh issue/reissue write and the intake/master-plan
 * LCL allocation both persist carrierType without this law.
 *
 * Unit-only tree (2026-10-19 owner ruling): the pure decision half lives in
 * dispatch-lcl-sourcing.ts and is unit-tested for real behavior here; the
 * db-bound assertion is pinned as wiring scans on the write service.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { lclTruckInternalFleetRefusal } from '../../services/dispatch-lcl-sourcing';

describe('SIL-939 — the sourcing decision (pure law)', () => {
  const TRUCK_CLASS = { isContainer: false, code: '5T' };
  const CONTAINER_CLASS = { isContainer: true, code: 'CONT20' };

  it('refuses OWN on an LCL truck class with the law message', () => {
    assert.equal(
      lclTruckInternalFleetRefusal('OWN', { cargoMode: 'LCL' }, TRUCK_CLASS),
      'Hàng lẻ xe tải 100% xe ngoài — không thể chọn Đội xe nội bộ (loại xe 5T). Chọn Nhà xe (xe ngoài).',
    );
  });

  it('keeps both sources on container classes (LCL ghép CONT 20\'/40\')', () => {
    assert.equal(lclTruckInternalFleetRefusal('OWN', { cargoMode: 'LCL' }, CONTAINER_CLASS), null);
  });

  it('never judges EXTERNAL picks, FCL lots, or class-less lots', () => {
    assert.equal(lclTruckInternalFleetRefusal('EXTERNAL', { cargoMode: 'LCL' }, TRUCK_CLASS), null);
    assert.equal(lclTruckInternalFleetRefusal('OWN', { cargoMode: 'FCL' }, TRUCK_CLASS), null);
    assert.equal(lclTruckInternalFleetRefusal('OWN', { cargoMode: 'LCL' }, null), null);
    assert.equal(lclTruckInternalFleetRefusal('OWN', { cargoMode: 'LCL' }, undefined), null);
  });
});

describe('SIL-939 — wiring: every dispatch plan write path runs the gate', () => {
  const write = readFileSync(
    path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan.service.ts'),
    'utf8',
  );

  /** Slice one top-level export's source through the next top-level export. */
  const fnSource = (name: string): string => {
    const start = write.indexOf(`export async function ${name}`);
    assert.ok(start > 0, `${name} must exist`);
    const next = write.indexOf('\nexport ', start + 1);
    return write.slice(start, next > start ? next : undefined);
  };

  for (const name of ['assignFulfillmentCarrierInTx', 'assignFulfillmentPlateInTx', 'updateDispatchDetailPlanInTx']) {
    it(`${name} refuses the internal fleet before any write`, () => {
      const body = fnSource(name);
      const guard = body.indexOf('await assertLclTruckExternalOnly(tx,');
      assert.ok(guard > 0, `${name} must run the shared sourcing guard`);
      const firstWrite = body.indexOf('.update(s.shipmentFulfillments)');
      assert.ok(firstWrite > guard, `${name}'s guard must precede its fulfillment write (all-or-nothing)`);
    });
  }

  it('the shared guard resolves the class COST-first, else the lot rev class', () => {
    const helper = write.slice(
      write.indexOf('async function assertLclTruckExternalOnly('),
      write.indexOf('export async function assignFulfillmentCarrierWriteCommand'),
    ).replace(/^\s*\/\/.*$/gm, '');
    assert.match(helper, /shipment\.costVehicleClassId \?\? shipment\.revVehicleClassId/,
      'an ungrouped LCL lot is judged through its own rev class');
    assert.match(helper, /lclTruckInternalFleetRefusal\(carrierType, shipment,/,
      'the refusal rides the shared pure law, never an ad-hoc guess');
    assert.match(helper, /throw new ApiError\(400, refusal\)/);
  });

  it('the plate endpoint exempts only the clear (unassign) write', () => {
    const body = fnSource('assignFulfillmentPlateInTx');
    const guard = body.indexOf('await assertLclTruckExternalOnly(tx,');
    assert.match(body.slice(0, guard), /input\.clear !== true/,
      'clear-only writes stay reachable so legacy OWN rows can unwind');
  });
});
