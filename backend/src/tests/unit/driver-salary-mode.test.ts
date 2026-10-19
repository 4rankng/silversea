// FB-103 (ticket 171026215600) — pin ánh xạ salary_type (text tự do trong
// bảng khách hàng) → salary_mode enum dùng chung cho migration backfill,
// seed-prod và master-data-import. NFD phải ra cùng kết quả NFC (Excel/macOS
// có thể xuất dạng phân tách).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salaryModeFromSalaryType } from '../../lib/driver-salary-mode';

test('salaryModeFromSalaryType — mapping theo nghĩa của bảng khách hàng', () => {
  assert.equal(salaryModeFromSalaryType('LƯƠNG CHUYẾN'), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType('LƯƠNG CỨNG'), 'FLAT_MONTHLY');
  assert.equal(salaryModeFromSalaryType('lương chuyến'), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType('lương cứng'), 'FLAT_MONTHLY');
  // Không dấu / viết thường.
  assert.equal(salaryModeFromSalaryType('luong chuyen'), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType('LUONG CUNG'), 'FLAT_MONTHLY');
});

test('salaryModeFromSalaryType — NFD (dạng phân tách) ra cùng kết quả NFC', () => {
  const nfdChuyen = 'LƯƠNG CHUYẾN'.normalize('NFD');
  const nfdCung = 'LƯƠNG CỨNG'.normalize('NFD');
  assert.notEqual(nfdChuyen, 'LƯƠNG CHUYẾN'); // đảm bảo đúng là NFD
  assert.equal(salaryModeFromSalaryType(nfdChuyen), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType(nfdCung), 'FLAT_MONTHLY');
});

test('salaryModeFromSalaryType — rỗng/giá trị lạ giữ mặc định PER_TRIP', () => {
  assert.equal(salaryModeFromSalaryType(null), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType(undefined), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType(''), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType('   '), 'PER_TRIP');
  assert.equal(salaryModeFromSalaryType('KHOÁN'), 'PER_TRIP');
});
