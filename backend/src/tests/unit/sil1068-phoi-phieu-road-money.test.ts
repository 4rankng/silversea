// SIL-1068 (K2.108) — Tiền đường của chuyến không có định mức là money
// CHƯA XÁC ĐỊNH, không phải số 0 giả. Quyết định chia sẻ giữa ô cột
// TIỀN ĐƯỜNG của bảng kiểm soát phơi phiếu (listPhoiPhieuRows) và số
// normAllowance của hộp thoại Chi tiết tiền đường (getPhoiPhieuTienDuong)
// nằm trong phoi-phieu-road-money.ts — module không dính db, chạy unit
// thật (luật BE unit-only 19/10). Wiring (hai call-site gọi cùng helper,
// select đủ carrierType + roadAllowanceOverride) được pin bằng source-scan
// đúng mẫu house (sil833-driver-road-norm-live.test.ts).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoiPhieuRoadMoney } from '../../services/phoi-phieu-road-money';

const here = dirname(fileURLToPath(import.meta.url));
const controlService = readFileSync(join(here, '../../services/phoi-phieu-control.service.ts'), 'utf8');

const OWN_MISSING_NORM = { carrierType: 'OWN', totalRoadAllowance: '0', roadAllowanceOverride: null };

test('tuyến không có định mức (total 0, không override) → null, không phải 0', () => {
  assert.equal(phoiPhieuRoadMoney(OWN_MISSING_NORM), null);
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, totalRoadAllowance: null }), null);
});

test('định mức quyết định số: tuyến 6 40FT = 460.000 giữ nguyên', () => {
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, totalRoadAllowance: '460000' }), 460000);
});

test('override tay là số đã quyết — cả 0; số hiển thị vẫn là total đã lưu', () => {
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, roadAllowanceOverride: '0' }), 0);
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, totalRoadAllowance: '300000', roadAllowanceOverride: '300000' }), 300000);
});

test('số tính khác 0 mà không có định mức vẫn là số (phụ cấp cầu đường/bonus)', () => {
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, totalRoadAllowance: 40000 }), 40000);
});

test('xe ngoài giữ hành vi cũ: số trên wire, kể cả 0', () => {
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, carrierType: 'EXTERNAL' }), 0);
  assert.equal(phoiPhieuRoadMoney({ carrierType: 'EXTERNAL', totalRoadAllowance: null, roadAllowanceOverride: null }), null);
});

test('carrierType null (legacy không có dòng trip_carrier_info) đọc như XE NHÀ', () => {
  assert.equal(phoiPhieuRoadMoney({ ...OWN_MISSING_NORM, carrierType: null }), null);
});

test('ô cột và hộp thoại cùng gọi helper — không surface nào tự tính lại', () => {
  const cellUses = controlService.match(/tienDuong: confirmedRoadByTrip\.has\(row\.tripId\)\s*\? confirmedRoadByTrip\.get\(row\.tripId\) \?\? 0\s*: phoiPhieuRoadMoney\(/);
  assert.ok(cellUses, 'ô TIỀN ĐƯỜNG phải đọc phoiPhieuRoadMoney');
  const dialogNormUses = controlService.match(/normAllowance: hasCountedConfirmedRows \? null : phoiPhieuRoadMoney\(/);
  assert.ok(dialogNormUses, 'normAllowance của hộp thoại phải đọc phoiPhieuRoadMoney');
  const select = controlService.match(/tienDuong: s\.tripFinancialState\.totalRoadAllowance,\s*roadAllowanceOverride: s\.tripFinancialState\.roadAllowanceOverride,\s*carrierType: s\.tripCarrierInfo\.carrierType,/);
  assert.ok(select, 'select của bảng phải đủ totalRoadAllowance + roadAllowanceOverride + carrierType');
});
