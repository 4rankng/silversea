// SIL-1147 — freight-preview không còn trả 400 NaN: một thiếu điều khoản tính
// cước là CÂU TRẢ LỜI (200 MISSING_INPUT nêu đúng phần thiếu, hợp đồng
// projection K2.24), chỉ ngày sai ĐỊNH DẠNG mới giữ 400 verbatim. Luật thuần
// nằm ở freight-preview-query.ts để suite unit không cần boot app.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { freightPreviewSkipBody, parseFreightPreviewQuery } from '../../services/freight-preview-query';

const VALID = { customerId: '1', routeId: '6', vehicleSizeClassCode: ' CONT20 ', transportDate: '2026-11-18' };

describe('SIL-1147 — parseFreightPreviewQuery: thiếu điều khoản → 200 MISSING_INPUT, hết NaN 400', () => {
  test('lô đủ căn cứ → ok với tham số đã chuẩn hóa (trim mã hạng xe)', () => {
    const parsed = parseFreightPreviewQuery(VALID);
    assert.deepEqual(parsed, {
      ok: true,
      mode: 'KEYS',
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
      mode: 'KEYS',
      input: { customerId: 279, routeId: 6, vehicleSizeClassCode: 'CONT40', transportDate: '2026-11-18' },
    });
  });
});

describe('SIL-1147 retest — chế độ shipmentId: probe lô đã lưu là hợp đồng, không phải thiếu khách hàng', () => {
  test('shipmentId nguyên dương → chế độ SHIPMENT (route tự giải mã grounds của lô)', () => {
    assert.deepEqual(parseFreightPreviewQuery({ shipmentId: '1207' }), { ok: true, mode: 'SHIPMENT', shipmentId: 1207 });
    // KEYS vẫn hoạt động cạnh shipmentId (tham số thừa bị bỏ qua).
    assert.deepEqual(
      parseFreightPreviewQuery({ shipmentId: '547', customerId: '1', routeId: '6', vehicleSizeClassCode: 'CONT20', transportDate: '2026-11-18' }),
      { ok: true, mode: 'SHIPMENT', shipmentId: 547 },
    );
  });

  test('shipmentId sai dạng là lỗi caller → FORMAT 400 (cùng lớp với ngày sai định dạng)', () => {
    for (const shipmentId of ['abc', '1.5', '0', '-2', ['1', '2']]) {
      const parsed = parseFreightPreviewQuery({ shipmentId });
      assert.equal(parsed.ok, false, `shipmentId=${String(shipmentId)}`);
      if (!parsed.ok && parsed.kind === 'FORMAT') {
        assert.equal(parsed.message, 'shipmentId phải là số nguyên dương');
      } else {
        assert.fail(`shipmentId=${String(shipmentId)} phải là FORMAT`);
      }
    }
    // Không có shipmentId → đường KEYS cũ nguyên vẹn.
    assert.equal(parseFreightPreviewQuery({}).ok, false);
  });

  test('freightPreviewSkipBody nêu đúng phần thiếu theo lý do SKIP của bộ phân loại', () => {
    assert.deepEqual(freightPreviewSkipBody('NO_CUSTOMER'), {
      readiness: 'MISSING_INPUT', message: 'Thiếu khách hàng để xem cước dự kiến.', missingInput: 'khách hàng',
    });
    assert.deepEqual(freightPreviewSkipBody('NO_ROUTE'), {
      readiness: 'MISSING_INPUT', message: 'Thiếu tuyến đường để xem cước dự kiến.', missingInput: 'tuyến đường',
    });
    assert.deepEqual(freightPreviewSkipBody('NO_RATE_KEY'), {
      readiness: 'MISSING_INPUT', message: 'Thiếu loại xe tính cước để xem cước dự kiến.', missingInput: 'loại xe tính cước',
    });
    assert.deepEqual(freightPreviewSkipBody('NO_TRANSPORT_DATE'), {
      readiness: 'MISSING_INPUT', message: 'Thiếu ngày vận chuyển để xem cước dự kiến.', missingInput: 'ngày vận chuyển',
    });
    assert.deepEqual(freightPreviewSkipBody('MISSING_WEIGHT'), {
      readiness: 'MISSING_INPUT', message: 'Thiếu trọng tải hàng để chọn cột giá container.', missingInput: 'trọng tải hàng',
    });
    assert.deepEqual(freightPreviewSkipBody('AD_HOC').missingInput, 'lô lệnh chạy ngoài');
    // Lô đã ghép cước (luật 0-share): preview không tự tra cước riêng — nó
    // nêu trạng thái nhóm, không bao giờ trả số của lô thành viên.
    assert.deepEqual(freightPreviewSkipBody('REV_GROUPED'), {
      readiness: 'MISSING_INPUT',
      message: 'Lô đã ghép cước thu khách — cước vận tải do nhóm ghép giữ (Lô 1 giữ 100% cước thu nhóm); tách nhóm để xem cước riêng.',
      missingInput: 'cước riêng của lô (đã ghép cước)',
    });
  });
});
