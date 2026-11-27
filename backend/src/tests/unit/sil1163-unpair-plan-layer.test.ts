/**
 * SIL-1163 — Hủy ghép cặp Kẹp xong, lệnh 2 vẫn hiện cùng xe + tài xế trên
 * lưới điều vận (KB Ch.3 §3.3.5: bỏ ghép phải cập nhật quan hệ ghép + lịch
 * xe, cặp bỏ không chồng lịch; hộp thoại Hủy ghép tự hứa "Lệnh 2 giữ giờ
 * hẹn nhưng trả xe về chờ phân công").
 *
 * Repro (owner, build 2881141d): unpair pair 67 — trips layer released đúng
 * (GET /api/trips/685 truckId null) NHƯNG GET /api/shipments/dispatch-
 * detail-plan-rows vẫn trả assignedPlate '15H-104.03' + assignedDriverName
 * trên fulfillment 1289, và driver 16 vẫn gắn cả 2 lệnh cùng giờ. Hai nguồn
 * đọc khác tầng chuyến là thủ phạm:
 *   - assignedPlate (OWN) = shipment_fulfillments.planned_vehicle_plate_number
 *     — snapshot kế hoạch mà unpair không reset;
 *   - assignedDriverName  = trips.driver_id qua join drivers (live) — luật
 *     round-27 "giữ tài xế" (vehicle-only release) giữ chân tài xế trên lệnh
 *     đã trả xe.
 * Ngoài ra nhật ký của chính lần hủy ghép ghi "đã tạo mới lệnh vận chuyển:
 * TRP-202610-0043" — generic ENTITY_CREATED trên entityType 'trips' với
 * entityId = pairId 67, enrich nhầm vào chuyến 67 (COMPLETED 30/10, không
 * liên quan). Fix: sự kiện riêng TRIP_PAIR_UNPAIRED, entityType 'trip-pairs',
 * enrich nêu đúng cặp + cả 2 chuyến.
 *
 * BE unit-only ruling: the DB-bound command is pinned by source-scan (the
 * sil1021 file's established pattern); the audit registry / extract /
 * render pieces are pure functions pinned by direct call.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractAuditEntityId,
  extractAuditEntityType,
  shouldScheduleAuditEnrichmentForTest,
} from '../../services/audit.service';
import { registerAuditEvent, resolveAuditEvent } from '../../services/audit-registry';
import { AuditEvent, type AuditEventType } from '../../services/audit-types';
import { renderAuditMessage } from '../../services/audit-templates';

const here = path.dirname(fileURLToPath(import.meta.url));
const pairsSource = readFileSync(
  path.join(here, '../../services/trip-pairs.service.ts'),
  'utf8',
);
const planRowsSource = readFileSync(
  path.join(here, '../../services/dispatch-planning-detail-plan-read.service.ts'),
  'utf8',
);
const tripRoutesIndexSource = readFileSync(
  path.join(here, '../../routes/trips/index.ts'),
  'utf8',
);
const auditServiceSource = readFileSync(
  path.join(here, '../../services/audit.service.ts'),
  'utf8',
);
const auditTemplatesSource = readFileSync(
  path.join(here, '../../services/audit-templates.ts'),
  'utf8',
);

describe('SIL-1163 — unpair dọn sạch tầng kế hoạch điều xe', () => {
  const unpairBody = () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    return pairsSource.slice(fnIdx, pairsSource.indexOf('/** Arguments of the pairing core'));
  };

  it('the release clears leg 2\'s driver together with the rig', () => {
    const body = unpairBody();
    assert.match(body, /truckId: null,\s*\n\s*trailerId: null,\s*\n\s*driverId: null,/,
      'the TRẢ XE release clears truck, trailer AND driver from leg 2 — the '
      + 'driver must not stay booked on both legs in the same window');
    assert.match(body, /eq\(s\.trips\.id, pair\.secondTripId\)/,
      'the release still targets only the second leg');
    assert.match(body, /inArray\(s\.trips\.status, \[TripStatus\.CREATED, TripStatus\.IN_TRANSIT\]\)/,
      'only live schedules release — the terminal-leg refusal sits above');
  });

  it('the release resets leg 2\'s fulfillment planned-plate snapshot', () => {
    const body = unpairBody();
    assert.match(body, /\.returning\(\{ fulfillmentId: s\.trips\.fulfillmentId \}\)/,
      'the release observes WHICH fulfillment it released — the snapshot '
      + 'reset must ride the same live-schedule guard, not blind both legs');
    assert.match(body, /plannedVehiclePlateNumber: null,/,
      'the dispatch plan cell\'s plate is the fulfillment snapshot — '
      + 'unpair must clear it or the grid keeps showing the returned plate');
    assert.match(body, /if \(releasedFulfillmentId != null\) \{/,
      'the snapshot reset guards the nullable fulfillment link');
  });

  it('plan rows read exactly the fields the release resets — the wire goes clean', () => {
    // OWN rows: assignedPlate = the fulfillment snapshot column.
    assert.match(planRowsSource, /assignedPlate: row\.tripId != null && row\.plannedCarrierType === 'EXTERNAL'\s*\n\s*\? tripExternalPlates\.get\(row\.tripId\) \?\? row\.plannedVehiclePlateNumber\s*\n\s*: row\.plannedVehiclePlateNumber,/,
      'the plan cell renders plannedVehiclePlateNumber for OWN rows — the '
      + 'unpair snapshot reset is what removes the returned plate');
    // assignedDriverName (issued rows) = the live trips.driver_id join.
    assert.match(planRowsSource, /\.leftJoin\(s\.drivers, eq\(s\.drivers\.id, s\.tripsComposite\.driverId\)\)/,
      'assignedDriverName joins trips.driver_id — the driver release is what '
      + 'removes the name from the released leg\'s row');
    assert.match(planRowsSource, /assignedDriverName: row\.tripId != null\s*\n\s*\? tripDriverNames\.get\(row\.tripId\) \?\? null/,
      'issued rows render the live trip driver, never a stored copy');
  });
});

describe('SIL-1163 — nhật ký hủy ghép nêu đúng cặp/chuyến', () => {
  it('the route file registers TRIP_PAIR_UNPAIRED on the /unpair suffix', () => {
    assert.match(tripRoutesIndexSource, /registerAuditEvent\('POST', '\/api\/trips\/', '\/unpair', AuditEvent\.TRIP_PAIR_UNPAIRED\)/,
      'the unpair verb must carry its own audit event, not the generic POST fallback');
  });

  it('resolveAuditEvent maps the unpair call to TRIP_PAIR_UNPAIRED (suffix law)', () => {
    // Mirror of the routes/trips/index.ts registration (source-pinned above):
    // proves the suffix shape actually matches POST /api/trips/pairs/:id/unpair.
    // Sibling verbs (/cancel, /copy) ride the route module's own registrations —
    // not loaded in this unit process, so they are not asserted here.
    registerAuditEvent('POST', '/api/trips/', '/unpair', AuditEvent.TRIP_PAIR_UNPAIRED);
    assert.equal(resolveAuditEvent('POST', '/api/trips/pairs/67/unpair'), 'TRIP_PAIR_UNPAIRED' satisfies AuditEventType);
  });

  it('pair paths resolve entityType trip-pairs — never enriching a pair id against trips', () => {
    assert.equal(extractAuditEntityType('/api/trips/pairs'), 'trip-pairs');
    assert.equal(extractAuditEntityType('/api/trips/pairs/67/unpair'), 'trip-pairs');
    // Plain trip paths stay 'trips'.
    assert.equal(extractAuditEntityType('/api/trips/123/cancel'), 'trips');
    // The unpair verb yields the PAIR id from the path.
    assert.equal(extractAuditEntityId('/api/trips/pairs/67/unpair', {}), 67);
    assert.equal(extractAuditEntityId('/api/trips/123/cancel', {}), 123);
  });

  it('the rendered message names the unpair, never "đã tạo mới lệnh vận chuyển"', () => {
    const message = renderAuditMessage({
      event: AuditEvent.TRIP_PAIR_UNPAIRED,
      entityType: 'trip-pairs',
      entityId: 67,
      entityKey: '#67 (chuyến TRP-202611-0683 + TRP-202611-0685)',
      actorRole: 'DISPATCHER',
      actorName: 'Nguyễn Điều Vận',
    });
    assert.match(message, /đã hủy ghép cặp #67 \(chuyến TRP-202611-0683 \+ TRP-202611-0685\)/,
      'the journal must name the pair AND both dissolved trips');
    assert.doesNotMatch(message, /đã tạo mới lệnh vận chuyển/,
      'the wrong-code create pattern must never render on an unpair row');
  });

  it('trip-pairs rows enrich to "#id (chuyến CODE1 + CODE2)" from the pair row', () => {
    assert.match(auditServiceSource, /payload\.entityType === 'trip-pairs' && payload\.entityId/,
      'the enrichment branch keys on the trip-pairs entity type');
    assert.match(auditServiceSource, /\.from\(s\.tripPairs\)/,
      'the enrichment reads the PAIR row — never trips by the pair id');
    assert.match(auditServiceSource, /firstTripCode: pairFirstTrips\.tripCode,/,
      'both legs\' codes ride the entity key');
    assert.match(auditServiceSource, /chuyến \$\{legCodes\.join\(' \+ '\)\}/,
      'the key renders both chuyến codes');
    // Generic ENTITY_* rows for pair paths read the honest label.
    assert.match(auditTemplatesSource, /'trip-pairs': 'cặp ghép chuyến',/,
      'ENTITY_CREATED on a pair path renders the pair label, not lệnh vận chuyển');
    assert.match(auditTemplatesSource, /\[AuditEvent\.TRIP_PAIR_UNPAIRED\]: \(c\) => `\$\{subj\(c\)\} đã hủy ghép cặp/,
      'the template renders the hủy-ghép verb');
  });

  it('trip-pairs audit rows are enrichment-eligible', () => {
    assert.equal(shouldScheduleAuditEnrichmentForTest({
      event: AuditEvent.TRIP_PAIR_UNPAIRED,
      entityType: 'trip-pairs',
      entityId: 67,
    }), true,
      'without enrichment the row keeps a keyless message');
  });
});
