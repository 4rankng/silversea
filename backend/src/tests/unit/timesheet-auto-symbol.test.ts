// SIL-737 — "chuyến nội bộ chuyển 'Đã hoàn thành' tự ghi ký hiệu (Đ/K/Q) vào
// lưới Chấm công lái xe /timesheet theo ngày hoàn thành".
//
// findBillSuggestions / syncTimesheetSymbolForTrip dính db nên unit test không
// được chạy app/DB (luật BE unit-only 19/10) — tầng luật thuần đã pin ở
// shared (`timesheetSalary.test.ts`: timesheetSymbolForDay). Tầng wiring ở đây
// dùng source-scan đúng mẫu house (debit-note-live-bks.test.ts): những quyết
// định KHÔNG THỂ kiểm tra bằng unit test (gọi auto-write ở đúng cửa chuyển
// trạng thái, lọc xe nội bộ, tôn trọng ô Điều vận gõ tay) được chốt tại
// đây; hành vi thật trên DB có probe qa/scripts/.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, '../..', relative), 'utf8');

const statusMachine = read('services/trip-status-machine.service.ts');
const autoSymbol = read('services/timesheet-auto-symbol.service.ts');
const timesheetService = read('services/timesheet.service.ts');
const timesheetSchema = read('db/schema/timesheet.ts');

test('SIL-737 — cửa chuyển trạng thái gọi auto-write khi hoàn thành VÀ khi huỷ', () => {
  assert.match(statusMachine, /import \{ syncTimesheetSymbolForTrip \} from '\.\/timesheet-auto-symbol\.service'/);
  // Hoàn thành: ghi ký hiệu theo ngày hoàn thành.
  const completion = statusMachine.slice(statusMachine.indexOf('const completedAt = targetStatus'));
  assert.match(completion, /if \(completedAt != null\) \{\s*await syncTimesheetSymbolForTrip\(tripId, userId, tx\);/);
  // Huỷ: ô ghi tự động của ngày đó phải được làm mới (xoá nếu hết chuyến).
  const cancel = statusMachine.slice(statusMachine.indexOf('targetStatus: TripStatus.CANCELED'));
  assert.match(cancel, /await syncTimesheetSymbolForTrip\(tripId, userId, tx\);/);
});

test('SIL-737 — auto-write chỉ nhận chuyến XE NỘI BỘ (xe không thuộc nhà xe ngoài)', () => {
  assert.match(autoSymbol, /isNull\(s\.trucks\.carrierId\)/);
  assert.match(autoSymbol, /trip\.carrierId != null\) return \{[^}]*'NOT_INTERNAL_TRIP'/);
  // Chuyến không có lái xe ⇒ không có ô chấm công để ghi.
  assert.match(autoSymbol, /trip\.driverId == null\) return \{[^}]*'NO_DRIVER'/);
});

test('SIL-737 — ngày ghi là NGÀY HOÀN THÀNH theo luật SIL-683 (UTC → VN), không phải ngày xuất phát', () => {
  assert.match(autoSymbol, /tripCompletionBusinessDateSql\(\)/);
  assert.doesNotMatch(autoSymbol, /departureDate/);
  // Ngày của chính chuyến và ngày lọc chuyến cùng dùng một phép tính.
  assert.equal(
    autoSymbol.match(/tripCompletionBusinessDateSql\(\)/g)?.length ?? 0,
    2,
    'ngày của chuyến và ngày lọc phải cùng luật',
  );
});

test('SIL-737 — ô Điều vận gõ tay không bị đè; ô hệ thống ghi thì được làm mới', () => {
  assert.match(autoSymbol, /existing\.source === 'MANUAL'/);
  assert.match(autoSymbol, /source: 'AUTO'/);
  // Ô hệ thống ghi mà ngày đó hết chuyến thì bị xoá (chuyến bị huỷ).
  assert.match(autoSymbol, /executor\.delete\(s\.driverTimesheetDays\)/);
  // Tháng đã đối chiếu thì không ghi — bảng đã được niêm phong.
  assert.match(autoSymbol, /period\.status === 'RECONCILED'\) return \{[^}]*'SEALED_MONTH'/);
});

test('SIL-737 — lưới ghi tay đánh dấu ô là MANUAL (ô của Điều vận)', () => {
  assert.match(timesheetService, /source: 'MANUAL'/);
});

test('SIL-737 — cột source tồn tại trong schema với default MANUAL + ràng buộc', () => {
  assert.match(timesheetSchema, /source: varchar\('source', \{ length: 6 \}\)\.notNull\(\)\.default\('MANUAL'\)/);
  assert.match(timesheetSchema, /driver_timesheet_days_source_check/);
});
