// SIL-1039 (KB K5.18) — hạng container NẶNG thiếu giá riêng thì KHÔNG chặn:
// kế thừa giá/hệ số hạng nhẹ + nhãn 'kế thừa hạng nhẹ / giá tạm'; thiếu
// trọng tải mới là chặn. Root cause (r28a): resolveQuotationHints chỉ hỏi
// các ô [exact, base.LIGHT, base] — quotation import ghi ô hệ số theo
// CONT20.LIGHT/.HEAVY (quotation-import.service classCodeFromLabel) nên
// chân hàng nặng (dispatch hỏi base CONT20 + priceVehicleSizeClassCode
// CONT20.HEAVY) KHÔNG BAO GIỜ đọc được ô .HEAVY: hệ số/phụ phí dầu rơi
// nhầm vào ô thường/LIGHT.
//
// Luật hệ số tách seam thuần `quotation-heso-family.ts` (same precedent as
// pricing-table-selection + lcl-effective-freight — unit-only 19/10: unit
// tests không đụng DB); dây nối engine được pin bằng source scan.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quotationHeSoFamily,
  pickHeSoCell,
  heSoInheritsLightOnHeavy,
} from '../../services/quotation-heso-family';
import { classifyLotPricingBasis } from '../../services/freight-lot-basis';

const here = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(join(here, '../../services/freight-pricing-engine.service.ts'), 'utf8');

describe('SIL-1039 — họ ô hệ số: exact → .HEAVY → .LIGHT (kế thừa, nhãn) → base', () => {
  test('họ ứng viên chứa .HEAVY và giữ thứ tự ưu tiên; hỏi trực tiếp split tự khử trùng lặp', () => {
    assert.deepEqual(
      quotationHeSoFamily('CONT20').map((cell) => cell.code),
      ['CONT20', 'CONT20.HEAVY', 'CONT20.LIGHT'],
      'exact trùng base tự khử trùng lặp: CONT20 chỉ còn một lần (EXACT)',
    );
    assert.deepEqual(
      quotationHeSoFamily('CONT20.HEAVY').map((cell) => ({ code: cell.code, source: cell.source })),
      [
        { code: 'CONT20.HEAVY', source: 'EXACT' },
        { code: 'CONT20.LIGHT', source: 'LIGHT' },
        { code: 'CONT20', source: 'BASE' },
      ],
    );
  });

  test('ô .HEAVY có giá → chân nặng dùng giá .HEAVY (không rơi vào LIGHT)', () => {
    const picked = pickHeSoCell('CONT20', [
      { code: 'CONT20.LIGHT', heSo: '1.1000' },
      { code: 'CONT20.HEAVY', heSo: '1.2500' },
    ]);
    assert.equal(picked.heSo, 1.25);
    assert.equal(picked.source, 'HEAVY');
  });

  test('.HEAVY trống + .LIGHT có giá → kế thừa LIGHT + flag nhãn trên chân nặng', () => {
    const picked = pickHeSoCell('CONT20', [{ code: 'CONT20.LIGHT', heSo: '1.1000' }]);
    assert.equal(picked.heSo, 1.1);
    assert.equal(picked.source, 'LIGHT');
    // Dispatch hỏi base CONT20 + price class CONT20.HEAVY → nhãn giá tạm.
    assert.equal(heSoInheritsLightOnHeavy('CONT20', 'CONT20.HEAVY', picked.source), true);
    // Hỏi trực tiếp chân nặng (không có price class tách) cũng được nhãn.
    assert.equal(heSoInheritsLightOnHeavy('CONT20.HEAVY', 'CONT20.HEAVY', 'LIGHT'), true);
  });

  test('chân nhẹ/ô thường đọc .LIGHT là luật cột của nó — KHÔNG gắn nhãn giá tạm', () => {
    assert.equal(heSoInheritsLightOnHeavy('CONT20', 'CONT20', 'LIGHT'), false);
    assert.equal(heSoInheritsLightOnHeavy('CONT20', 'CONT20.LIGHT', 'LIGHT'), false);
    // Ô .HEAVY/EXACT/BASE của chân nặng không phải kế thừa hạng nhẹ.
    assert.equal(heSoInheritsLightOnHeavy('CONT20', 'CONT20.HEAVY', 'HEAVY'), false);
    assert.equal(heSoInheritsLightOnHeavy('CONT20', 'CONT20.HEAVY', 'BASE'), false);
  });

  test('không ô nào khớp → mặc định định kiến 5/7: heSo 1, DEFAULT', () => {
    const picked = pickHeSoCell('CONT20', [{ code: 'CONT40.HEAVY', heSo: '2' }]);
    assert.equal(picked.heSo, 1);
    assert.equal(picked.source, 'DEFAULT');
  });

  test('thiếu trọng tải vẫn chặn như cũ — K5.18 không mở cửa bịa giá (regression pin)', () => {
    const grounds = {
      isAdHoc: false,
      customerId: 9,
      routeId: 12,
      rateKey: 'CONT20',
      containerTransportDate: null,
      expectedDeliveryDate: '2026-11-26',
      containerCargoWeightKg: null,
    };
    const decision = classifyLotPricingBasis(grounds);
    assert.equal(decision.action, 'SKIP');
    assert.equal(decision.action === 'SKIP' ? decision.reason : null, 'MISSING_WEIGHT');
  });
});

describe('SIL-1039 — dây nối engine (source scan, unit-only)', () => {
  test('resolveQuotationHints chọn hệ số qua seam họ ô (không còn danh sách thiếu .HEAVY)', () => {
    assert.match(engine, /pickHeSoCell\(vehicleSizeClassCode, rows\)/);
    assert.doesNotMatch(engine, /\[vehicleSizeClassCode, `\$\{base\}\.LIGHT`, base\]/);
  });

  test('flag kế thừa LIGHT trên chân nặng + nhãn K5.18 ride công thức (surface hiện có)', () => {
    assert.match(engine, /heSoInheritsLightOnHeavy\(vehicleSizeClassCode, priceClassCode, heSoSource\)/);
    assert.match(engine, /heSoInheritedFromLight: heSoInheritedFromLight \|\| undefined/);
    // Nhãn dựng trên surface provenance hiện có (formula), không chế cột mới.
    assert.match(engine, /× hệ số \$\{heSo\}\$\{heSoInheritedFromLight \? ' \(kế thừa hạng nhẹ \/ giá tạm — K5\.18\)' : ''\}/);
  });
});
