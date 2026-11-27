// SIL-1147 — freight-preview không còn trả 400 NaN: một thiếu điều khoản tính
// cước là CÂU TRẢ LỜI (200 MISSING_INPUT nêu đúng phần thiếu, hợp đồng
// projection K2.24), chỉ ngày sai ĐỊNH DẠNG mới giữ 400 verbatim. Luật thuần
// nằm ở freight-preview-query.ts để suite unit không cần boot app.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFreightPreviewQuery } from '../../services/freight-preview-query';

const VALID = { customerId: '1', routeId: '6', vehicleSizeClassCode: ' CONT20 ', transportDate: '2026-11-18' };

describe('SIL-1147 — parseFreightPreviewQuery: thiếu điều khoản → 200 MISSING_INPUT, hết NaN 400', () => {
  test('lô đủ căn cứ → ok với tham số đã chuẩn hóa (trim mã hạng xe)', () => {
    const parsed = parseFreightPreviewQuery(VALID);
    assert.deepEqual(parsed, {
      ok: true,
      input: { customerId: 1, routeId: 6, vehicleSizeClassCode: 'CONT20', transportDate: '2026-11-18' },
    });
  });

  test('thiếu/NaN customerId → MISSING_INPUT "khách hàng" (probe shipmentId của QA r40b)', () => {
    for (const customerId of [undefined, '', 'abc', 'shipment', '1.5', '0', '-2', ['1', '2']]) {
      const parsed = parseFreightPreviewQuery({ ...VALID, customerId });
      assert.equal(parsed.ok, false, `customerId=${String(customerId)}`);
      if (!parsed.ok && parsed.kind === 'MISSING_INPUT') {
        assert.equal(parsed.body.readiness, 'MISSING_INPUT');
        assert.equal(parsed.body.missingInput, 'khách hàng');
        assert.match(parsed.body.message, /khách hàng/);
      } else {
        assert.fail(`customerId=${String(customerId)} phải là MISSING_INPUT`);
      }
    }
  });

  test('thiếu/NaN routeId → MISSING_INPUT "tuyến đường"', () => {
    for (const routeId of [undefined, '', 'abc', 'NaN', '0']) {
      const parsed = parseFreightPreviewQuery({ ...VALID, routeId });
      assert.equal(parsed.ok, false);
      if (!parsed.ok && parsed.kind === 'MISSING_INPUT') {
        assert.equal(parsed.body.missingInput, 'tuyến đường');
      } else {
        assert.fail(`routeId=${String(routeId)} phải là MISSING_INPUT`);
      }
    }
  });

  test('thiếu loại xe tính cước → MISSING_INPUT "loại xe tính cước"', () => {
    const parsed = parseFreightPreviewQuery({ ...VALID, vehicleSizeClassCode: '   ' });
    assert.equal(parsed.ok, false);
    if (!parsed.ok && parsed.kind === 'MISSING_INPUT') {
      assert.equal(parsed.body.missingInput, 'loại xe tính cước');
    } else {
      assert.fail('thiếu hạng xe phải là MISSING_INPUT');
    }
  });

  test('thiếu ngày vận chuyển → MISSING_INPUT "ngày vận chuyển"', () => {
    const parsed = parseFreightPreviewQuery({ ...VALID, transportDate: undefined });
    assert.equal(parsed.ok, false);
    if (!parsed.ok && parsed.kind === 'MISSING_INPUT') {
      assert.equal(parsed.body.missingInput, 'ngày vận chuyển');
    } else {
      assert.fail('thiếu ngày phải là MISSING_INPUT');
    }
  });

  test('ngày sai định dạng giữ 400 FORMAT verbatim (không thuộc lớp NaN)', () => {
    const parsed = parseFreightPreviewQuery({ ...VALID, transportDate: '2026/11/18' });
    assert.equal(parsed.ok, false);
    if (!parsed.ok && parsed.kind === 'FORMAT') {
      assert.equal(parsed.message, 'Ngày vận chuyển phải có dạng YYYY-MM-DD');
    } else {
      assert.fail('ngày sai định dạng phải là FORMAT');
    }
  });

  test('query mảng một phần tử vẫn là một giá trị hợp lệ', () => {
    const parsed = parseFreightPreviewQuery({
      customerId: ['279'], routeId: ['6'], vehicleSizeClassCode: ['CONT40'], transportDate: ['2026-11-18'],
    });
    assert.deepEqual(parsed, {
      ok: true,
      input: { customerId: 279, routeId: 6, vehicleSizeClassCode: 'CONT40', transportDate: '2026-11-18' },
    });
  });
});
