// SIL-1023 (K6.15b) — Nhật ký phải ghi đúng hành động khóa/mở khóa lô.
// Regression context (staging, lô 1225): bản ghi khóa (id 25661) ghi
// 'Kế toán Phạm Thị Hòa đã cập nhật thông tin lô hàng 1225'
// (SHIPMENT_UPDATED) vì '/lock' đăng ký SHIPMENT_UPDATED; bản ghi mở khóa
// (id 25685) ghi '… đã tạo mới lô hàng: 1225' (ENTITY_CREATED) vì '/unlock'
// KHÔNG có đăng ký nào → rơi vào fallback POST → ENTITY_CREATED. Luật mới:
// POST /api/shipments/:id/lock → SHIPMENT_COST_LOCKED ('đã khóa lô hàng N'),
// POST /api/shipments/:id/unlock → SHIPMENT_COST_UNLOCKED
// ('đã mở khóa lô hàng N').
//
// Unit-only ruling 19/10: registry resolution chạy thuần trên đăng ký cục bộ
// (registerAuditEvent/resolveAuditEvent không đụng DB); còn dây đăng ký thật
// trong routes/shipments/index.ts được pin bằng source scan — cùng style
// shipment-cost-unlock.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditEvent } from '../../services/audit-types';
import { registerAuditEvent, resolveAuditEvent } from '../../services/audit-registry';
import { renderAuditMessage } from '../../services/audit-templates';

const here = dirname(fileURLToPath(import.meta.url));
const registrationsSource = readFileSync(
  join(here, '../../routes/shipments/index.ts'),
  'utf8',
);

describe('SIL-1023 — registry nhận diện đúng sự kiện khóa/mở khóa lô', () => {
  // Đăng ký cục bộ cùng hình dạng đăng ký thật để chạy luật so khớp suffix
  // mà không kéo module routes (db-bound) vào unit test.
  registerAuditEvent('POST', '/api/shipments/', '/lock', AuditEvent.SHIPMENT_COST_LOCKED);
  registerAuditEvent('POST', '/api/shipments/', '/unlock', AuditEvent.SHIPMENT_COST_UNLOCKED);

  test('POST /api/shipments/:id/lock giải ra SHIPMENT_COST_LOCKED', () => {
    assert.equal(resolveAuditEvent('POST', '/api/shipments/1225/lock'), AuditEvent.SHIPMENT_COST_LOCKED);
  });

  test('POST /api/shipments/:id/unlock giải ra SHIPMENT_COST_UNLOCKED, không bị suffix /lock nuốt', () => {
    // Cơ chế lỗi gốc: so khớp suffix so cả segment — '/unlock' không endsWith
    // '/lock', nhưng trước khi có đăng ký riêng nó rơi vào fallback
    // POST → ENTITY_CREATED. Đăng ký dài hơn phải thắng fallback.
    assert.equal(resolveAuditEvent('POST', '/api/shipments/1225/unlock'), AuditEvent.SHIPMENT_COST_UNLOCKED);
    assert.notEqual(resolveAuditEvent('POST', '/api/shipments/1225/unlock'), 'ENTITY_CREATED');
  });

  test('đăng ký thật trong routes/shipments/index.ts dùng đúng cặp sự kiện mới', () => {
    assert.match(
      registrationsSource,
      /registerAuditEvent\('POST', '\/api\/shipments\/', '\/lock', AuditEvent\.SHIPMENT_COST_LOCKED\)/,
    );
    assert.match(
      registrationsSource,
      /registerAuditEvent\('POST', '\/api\/shipments\/', '\/unlock', AuditEvent\.SHIPMENT_COST_UNLOCKED\)/,
    );
    assert.doesNotMatch(
      registrationsSource,
      /registerAuditEvent\('POST', '\/api\/shipments\/', '\/lock', AuditEvent\.SHIPMENT_UPDATED\)/,
    );
  });
});

describe('SIL-1023 — nhãn thông báo audit khóa/mở khóa lô', () => {
  const base = { entityType: 'shipments', entityId: 1225, actorRole: 'ACCOUNTANT', actorName: 'Phạm Thị Hòa' };

  test('khóa lô renders "Kế toán Phạm Thị Hòa đã khóa lô hàng 1225"', () => {
    assert.equal(
      renderAuditMessage({ ...base, event: AuditEvent.SHIPMENT_COST_LOCKED }),
      'Kế toán Phạm Thị Hòa đã khóa lô hàng 1225',
    );
  });

  test('mở khóa renders "Kế toán Phạm Thị Hòa đã mở khóa lô hàng 1225" (không còn "tạo mới")', () => {
    assert.equal(
      renderAuditMessage({ ...base, event: AuditEvent.SHIPMENT_COST_UNLOCKED }),
      'Kế toán Phạm Thị Hòa đã mở khóa lô hàng 1225',
    );
    assert.notEqual(
      renderAuditMessage({ ...base, event: AuditEvent.SHIPMENT_COST_UNLOCKED }),
      'Kế toán Phạm Thị Hòa đã tạo mới lô hàng: 1225',
    );
  });
});
