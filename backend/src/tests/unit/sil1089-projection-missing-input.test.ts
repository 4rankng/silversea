// SIL-1089 (K2.24) — chưa đủ điều khoản tính cước: projection phải nêu ĐÚNG
// phần thiếu là dữ liệu (`missingInput`), không chỉ câu message imperative —
// block cước của lô hiển thị "Chưa xác định" + `Thiếu ${missingInput}`.
// Các nhánh đầu-vào dưới đây return TRƯỚC mọi truy vấn DB nên suite này
// không cần database.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveShipmentPricingProjection } from '../../services/pricing.service';

describe('SIL-1089 — ShipmentPricingProjection.missingInput nêu đúng phần thiếu (K2.24)', () => {
  test('LCL thiếu loại hàng → missingInput "loại hàng" (ca lô 1207)', async () => {
    const projection = await resolveShipmentPricingProjection({
      customerId: 1, routeId: 2, cargoMode: 'LCL',
    });
    assert.equal(projection.readiness, 'MISSING_INPUT');
    assert.equal(projection.missingInput, 'loại hàng');
    assert.match(projection.message, /Chọn loại hàng/);
  });

  test('LCL thiếu trọng lượng → "trọng lượng thực tế"', async () => {
    const projection = await resolveShipmentPricingProjection({
      customerId: 1, routeId: 2, cargoMode: 'LCL', cargoTypeId: 5,
    });
    assert.equal(projection.readiness, 'MISSING_INPUT');
    assert.equal(projection.missingInput, 'trọng lượng thực tế');
    assert.match(projection.message, /Nhập trọng lượng thực tế/);
  });

  test('thiếu tuyến đường / loại lô hàng / container → tên đúng từng phần', async () => {
    const noRoute = await resolveShipmentPricingProjection({ customerId: 1, cargoMode: 'LCL' });
    assert.equal(noRoute.missingInput, 'tuyến đường');

    const noMode = await resolveShipmentPricingProjection({ customerId: 1, routeId: 2 });
    assert.equal(noMode.missingInput, 'loại lô hàng');

    const noContainers = await resolveShipmentPricingProjection({
      customerId: 1, cargoMode: 'FCL', containerCount: 0,
    });
    assert.equal(noContainers.missingInput, 'container');
  });

  test('lệnh chạy ngoài (không khách danh mục) → missingInput null, message giải thích', async () => {
    const projection = await resolveShipmentPricingProjection({
      customerId: null, routeId: 2, cargoMode: 'FCL',
    });
    assert.equal(projection.readiness, 'MISSING_INPUT');
    assert.equal(projection.missingInput, null);
    assert.match(projection.message, /Lệnh chạy ngoài/);
  });
});
