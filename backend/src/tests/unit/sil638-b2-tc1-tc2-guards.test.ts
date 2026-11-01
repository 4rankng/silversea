/**
 * SIL-638 (id 742) đợt 2 — TC1 window law + TC2 classification-mismatch
 * message trên đường dispatch (QA verdict 01/11: TC1 FAIL — leg ca chiều
 * 14:00 bị chặn dù ca sáng 08:00–12:00 vì giờ kết thúc DO ĐIỀU VẬN NHẬP bị
 * ghi đè bằng duration tuyến (~12h) nên window "thực" phình to; TC2 FAIL —
 * phát ĐƠN lên xe đang giữ KẸP báo "trùng lịch" thay vì message phân loại).
 *
 * Pinned here (BE unit-only ruling 2026-10-19):
 *  - `issueClaimWindowEnd` — giờ kết thúc khai báo THẮNG; duration tuyến
 *    chỉ lấp chỗ trống (payload không gửi end); null khi không có gì cả.
 *  - TC1 composition: end thật 12:00 + tuyến 400km vẫn KHÔNG giao 14:00.
 *  - `classificationMismatchShareBlockMessage` — ĐƠN gặp holder Kẹp/Kết hợp
 *    → text phân loại; Kẹp phát lên ĐƠN giữ luật dis-03 (confirmable warn,
 *    owner ruling card 211026131857 — không reopen); 2 bên cùng khai báo →
 *    null (carve path riêng).
 *  - wiring locks: issue schema cho phép end tùy chọn; issue path dùng
 *    issueClaimWindowEnd; availability + plan-assign guard ném message TC2
 *    TRƯỚC message trùng lịch; IN_TRANSIT law không đổi (truck-busy gate).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
  classificationMismatchShareBlockMessage,
  issueClaimWindowEnd,
  tripClaimWindowOverlaps,
} from '../../services/trip-pair-rules.service';

function utc(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, 9, day, hour, 0, 0));
}

describe('issueClaimWindowEnd (SIL-638 đợt 2 TC1 — giờ kết thúc khai báo thắng)', () => {
  it('end do điều vận nhập thắng — tuyến 400km (~12h duration) KHÔNG ghi đè 08:00→12:00', () => {
    const end = issueClaimWindowEnd(utc(31, 12), utc(31, 8), 400);
    assert.equal(end?.getTime(), utc(31, 12).getTime());
  });

  it('payload không gửi end → duration tuyến lấp chỗ trống (400km ≈ 11h54m + 30m buffer)', () => {
    const end = issueClaimWindowEnd(null, utc(31, 8), 400);
    assert.ok(end != null);
    const expectedMinutes = Math.ceil((400 / 35) * 60) + 30;
    assert.equal(end!.getTime(), utc(31, 8).getTime() + expectedMinutes * 60_000);
  });

  it('không end, không duration tuyến (distance null) → null (caller giữ gate endTimeConfirmed)', () => {
    assert.equal(issueClaimWindowEnd(null, utc(31, 8), null), null);
    assert.equal(issueClaimWindowEnd(null, utc(31, 8), 0), null);
  });

  it('TC1 composition: ca sáng 08:00–12:00 (end thật) và ca chiều 14:00–18:00 KHÔNG giao nhau — ngay cả trên tuyến 400km', () => {
    const morningEnd = issueClaimWindowEnd(utc(31, 12), utc(31, 8), 400)!;
    const eveningEnd = issueClaimWindowEnd(utc(31, 18), utc(31, 14), 400)!;
    assert.equal(
      tripClaimWindowOverlaps(utc(31, 14).toISOString(), eveningEnd.toISOString(), utc(31, 8), morningEnd),
      false,
      'ca chiều không được chặn vì window phình của ca sáng',
    );
  });

  it('TC1 composition: 10:00–14:00 TRÙNG ca sáng → vẫn chặn', () => {
    const morningEnd = issueClaimWindowEnd(utc(31, 12), utc(31, 8), 400)!;
    assert.equal(
      tripClaimWindowOverlaps(utc(31, 10).toISOString(), utc(31, 14).toISOString(), utc(31, 8), morningEnd),
      true,
    );
  });
});

describe('classificationMismatchShareBlockMessage (SIL-638 đợt 2 TC2 — message phân loại)', () => {
  const MESSAGE = 'Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe';
  assert.equal(CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE, MESSAGE);

  it('phát ĐƠN (SINGLE) lên xe đang giữ Kẹp (DOUBLE) → message phân loại', () => {
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'DOUBLE'), MESSAGE);
  });

  it('phát ĐƠN lên xe đang giữ Kết hợp (COMBINED) → message phân loại', () => {
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'COMBINED'), MESSAGE);
  });

  it('phát leg chưa khai phân loại lên holder Kẹp → message phân loại', () => {
    assert.equal(classificationMismatchShareBlockMessage(null, 'DOUBLE'), MESSAGE);
  });

  it('2 bên cùng khai báo (DOUBLE↔DOUBLE, COMBINED↔COMBINED) → null (carve path riêng)', () => {
    assert.equal(classificationMismatchShareBlockMessage('DOUBLE', 'DOUBLE'), null);
    assert.equal(classificationMismatchShareBlockMessage('COMBINED', 'COMBINED'), null);
  });

  it('Kẹp phát lên holder ĐƠN → null (dis-03 giữ confirmable warn — không reopen owner ruling)', () => {
    assert.equal(classificationMismatchShareBlockMessage('DOUBLE', 'SINGLE'), null);
    assert.equal(classificationMismatchShareBlockMessage('COMBINED', 'SINGLE'), null);
  });

  it('holder thường (SINGLE/null) không sinh message', () => {
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'SINGLE'), null);
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', null), null);
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'LCL'), null);
  });
});

describe('SIL-638 đợt 2 wiring lock — TC1/TC2 chạy thật trên đường dispatch', () => {
  const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../services');
  const commandsSource = readFileSync(path.join(servicesDir, 'dispatch-planning-commands.service.ts'), 'utf8');
  const availabilitySource = readFileSync(path.join(servicesDir, 'dispatch-resource-availability.service.ts'), 'utf8');
  const detailPlanSource = readFileSync(path.join(servicesDir, 'dispatch-planning-detail-plan.service.ts'), 'utf8');
  const coreRoutesSource = readFileSync(path.join(servicesDir.replace('/services', '/routes/shipments'), 'core.routes.ts'), 'utf8');

  it('issue path: giờ kết thúc khai báo thắng qua issueClaimWindowEnd (không bị duration tuyến ghi đè)', () => {
    assert.match(commandsSource, /import \{ issueClaimWindowEnd \} from '\.\/trip-pair-rules\.service';/);
    assert.match(commandsSource, /issueClaimWindowEnd\(declaredEndAt, plannedStartAt, route\?\.distanceKm \?\? null\)/);
    assert.match(commandsSource, /plannedEndAt\?: string/);
    // Route-duration override của luật cũ đã retreat khỏi issue path.
    assert.doesNotMatch(commandsSource, /plannedEndAt = serviceDurationMinutes == null/);
  });

  it('issue schema cho phép payload không gửi plannedEndAt (duration tuyến lấp chỗ trống)', () => {
    assert.match(coreRoutesSource, /plannedEndAt: z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)/);
  });

  it('availability guard: message TC2 TRƯỚC message "Xe đầu kéo đã bị trùng lịch kế hoạch"', () => {
    const mismatchIdx = availabilitySource.indexOf('classificationMismatchShareBlockMessage(kep');
    const genericIdx = availabilitySource.indexOf("'Xe đầu kéo đã bị trùng lịch kế hoạch.'");
    assert.ok(mismatchIdx > -1, 'availability guard phải dùng classificationMismatchShareBlockMessage');
    assert.ok(genericIdx > mismatchIdx, 'message phân loại phải đứng TRƯỚC message trùng lịch trong guard');
  });

  it('plan-assign guard: cùng message TC2, và classification hiệu lực = lưu sẵn khi save không quản lý', () => {
    assert.match(detailPlanSource, /CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE/);
    assert.match(detailPlanSource, /classification: input\.classification \?\? fulfillment\.dispatchClassification/);
  });

  it('IN_TRANSIT giữ nguyên: conflicts scan vẫn gộp CREATED + IN_TRANSIT (đúng doc TC1 bước 3)', () => {
    assert.match(
      availabilitySource,
      /inArray\(s\.trips\.status, \[TripStatus\.CREATED, TripStatus\.IN_TRANSIT\]\)/,
    );
  });
});
