// SIL-833 — "Tiền đường lái xe: định mức tuyến không bao giờ hiện, luôn
// 'Chưa có định mức tiền tuyến'". Chuyến tạo TRƯỚC khi dòng road_allowances
// tồn tại đóng băng totalRoadAllowance '0' lúc tạo (snapshot trip-create) và
// không có đường nào re-resolve — driver nhìn 'Chưa có định mức tiền tuyến'
// ở MỌI trạng thái (CREATED/IN_TRANSIT/COMPLETED), kể cả sau khi admin đã
// tạo định mức tuyến × loại rơ-moóc.
//
// getDriverTripDetail dính db nên không chạy app/DB trong unit test (luật BE
// unit-only 19/10) — tầng wiring chốt bằng source-scan đúng mẫu house
// (timesheet-auto-symbol.test.ts): những quyết định không thể kiểm bằng unit
// (chỉ tra khi snapshot 0, override tay thắng, đúng khoá tuyến × rơ-moóc,
// loại dòng xoá mềm, chạy TRƯỚC buildTripBreakdown để band và breakdown
// cùng một số) được pin tại đây; hành vi thật trên DB có probe qa/scripts.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const driverService = readFileSync(join(here, '../../services/driver.service.ts'), 'utf8');

// The re-resolve block lives inside getDriverTripDetail, between the trip
// null-check and the legs/containers loads — slice to that function body.
const fnStart = driverService.indexOf('export async function getDriverTripDetail(');
assert.notEqual(fnStart, -1, 'getDriverTripDetail phải tồn tại');
const fnBody = driverService.slice(fnStart, fnStart + 12_000);

test('SIL-833 — chỉ tra định mức khi snapshot 0, OWN, không override, có loại rơ-moóc', () => {
  assert.match(fnBody, /trip\.carrierType === 'OWN'/);
  assert.match(fnBody, /trip\.roadAllowanceOverride == null/);
  assert.match(fnBody, /Number\(trip\.totalRoadAllowance \?\? 0\) <= 0/);
  assert.match(fnBody, /trip\.trailerType != null/);
});

test('SIL-833 — khoá tra định mức đúng TUYẾN × LOẠI RƠ-MOÓC, bỏ dòng xoá mềm', () => {
  assert.match(fnBody, /eq\(s\.roadAllowances\.routeId, trip\.routeId\)/);
  assert.match(fnBody, /eq\(s\.roadAllowances\.trailerType, trip\.trailerType\)/);
  assert.match(fnBody, /isNull\(s\.roadAllowances\.deletedAt\)/);
});

test('SIL-833 — giá trị tra được ghi NGAY vào totalRoadAllowance (band + breakdown cùng số)', () => {
  assert.match(fnBody, /trip\.totalRoadAllowance = String\(Number\(liveAllowance\.baseAmount\)\)/);
  // Re-resolve chạy TRƯỚC buildTripBreakdown — Chi phí chuyến (COMPLETED)
  // và Tạm tính định mức không được hiện hai số khác nhau.
  const resolveEnd = fnBody.indexOf('trip.totalRoadAllowance = String(Number(liveAllowance.baseAmount))');
  const breakdownCall = fnBody.indexOf('buildTripBreakdown(trip)');
  assert.notEqual(breakdownCall, -1, 'buildTripBreakdown phải được gọi');
  assert.ok(resolveEnd < breakdownCall, 're-resolve phải đứng trước buildTripBreakdown');
});

test('SIL-833 — payload driver select đủ routeId + roadAllowanceOverride cho re-resolve', () => {
  assert.match(fnBody, /routeId: s\.tripsComposite\.routeId/);
  assert.match(fnBody, /roadAllowanceOverride: s\.tripsComposite\.roadAllowanceOverride/);
});
