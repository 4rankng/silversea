// SIL-735 (spec fix 2 07/11 §III.3): tra cứu "Thêm cược" phải khớp CHUỖI CON
// trên CẢ blNumber VÀ bookingRef — 4 số cuối của bill VÀ 4 số cuối của booking
// đều ra đúng lô.
//
// Tầng 1 (pure, db-free — luật BE unit-only 19/10): `bill-digit-match.ts` là
// leaf thuần, không import db/client/app. `parseBillDigits` chốt hợp đồng input
// 4 chữ số; `billDigitsNeedle` chốt hình dạng needle mà SQL dùng.
// Tầng 2 (wiring): findBillSuggestions dính db nên không unit-test được — chốt
// bằng source-scan đúng mẫu house (debit-note-live-bks.test.ts): hai nhánh
// blNumber VÀ bookingRef cùng dùng needle của luật thuần, không còn luật đuôi
// `right(...)`.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BILL_DIGITS, billDigitsNeedle, parseBillDigits } from '../../services/bill-digit-match';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '../../services/bill-book-search.service.ts'), 'utf8');

function suggestionsBody(): string {
  const start = serviceSource.indexOf('export async function findBillSuggestions');
  assert.ok(start > 0, 'findBillSuggestions not found');
  return serviceSource.slice(start);
}

test('SIL-735 — parseBillDigits chỉ nhận đúng 4 chữ số (thói quen tra cứu)', () => {
  assert.equal(parseBillDigits('0044'), '0044');
  assert.equal(parseBillDigits(' 0044 '), '0044');
  assert.throws(() => parseBillDigits('044'), /Nhập đúng 4 số cuối/);
  assert.throws(() => parseBillDigits('00a4'), /Nhập đúng 4 số cuối/);
  assert.throws(() => parseBillDigits('00444'), /Nhập đúng 4 số cuối/);
  assert.equal(BILL_DIGITS, 4);
});

test('SIL-735 — needle là CHUỖI CON của chuỗi số (không phải đuôi)', () => {
  // Chuỗi con: 4 số cuối đọc được trên giấy (…0044 của Bill, …8601 của
  // Booking) là một đoạn BÊN TRONG chuỗi số, không nhất thiết ở cuối.
  assert.equal(billDigitsNeedle('0044'), '%0044%');
  assert.equal(billDigitsNeedle('8601'), '%8601%');
  // Needle không mang ký tự đặc biệt của SQL (chỉ số đã được validate).
  assert.doesNotMatch(billDigitsNeedle('0044'), /[^%\d]/);
});

test('SIL-735 — cả hai nhánh blNumber VÀ bookingRef dùng chuỗi số + needle của luật thuần', () => {
  const body = suggestionsBody();
  // Chuỗi số: bỏ chữ và dấu phân tách trước khi so (FB-096).
  assert.match(body, /regexp_replace\(\$\{s\.shipments\.blNumber\}, '\[\^0-9\]', '', 'g'\) ilike \$\{billDigitsNeedle\(digits\)\}/);
  assert.match(body, /regexp_replace\(\$\{s\.shipments\.bookingRef\}, '\[\^0-9\]', '', 'g'\) ilike \$\{billDigitsNeedle\(digits\)\}/);
  // Hai nhánh cùng sống trong một or() — bỏ nhánh booking là regression.
  const orBlock = body.slice(body.indexOf('or('), body.indexOf(') as SQL,'));
  assert.match(orBlock, /blNumber/);
  assert.match(orBlock, /bookingRef/);
  // Tombstone filter phải bọc CẢ HAI nhánh (or() gom trong and()).
  assert.match(body, /and\(\s*isNull\(s\.shipments\.deletedAt\),\s*or\(/);
});

test('SIL-735 — luật đuôi `right(...) = digits` cũ đã gỡ (thay bằng chuỗi con)', () => {
  assert.doesNotMatch(suggestionsBody(), /right\(regexp_replace/);
});
