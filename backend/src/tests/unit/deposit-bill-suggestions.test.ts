// SIL-735 (spec fix 2 07/11 §III.3): tra cứu "Thêm cược" phải khớp CHUỖI CON
// trên CẢ blNumber VÀ bookingRef — 4 số cuối của bill VÀ 4 số cuối của booking
// đều ra đúng lô. findBillSuggestions dính db nên unit test giữ 2 tầng thuần:
// parseBillDigits (hợp đồng input 4 chữ số) + source-scan chốt hình dạng match
// SQL (house pattern: debit-note-live-bks).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BILL_DIGITS, parseBillDigits } from '../../services/bill-book-search.service';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/bill-book-search.service.ts'), 'utf8');

function suggestionsBody(): string {
  const start = source.indexOf('export async function findBillSuggestions');
  assert.ok(start > 0, 'findBillSuggestions not found');
  return source.slice(start);
}

test('SIL-735 — parseBillDigits chỉ nhận đúng 4 chữ số (thói quen tra cứu)', () => {
  assert.equal(parseBillDigits('0044'), '0044');
  assert.equal(parseBillDigits(' 0044 '), '0044');
  assert.throws(() => parseBillDigits('044'), /Nhập đúng 4 số cuối/);
  assert.throws(() => parseBillDigits('00a4'), /Nhập đúng 4 số cuối/);
  assert.equal(BILL_DIGITS, 4);
});

test('SIL-735 — match SQL là chuỗi con của chuỗi số trên CẢ blNumber VÀ bookingRef', () => {
  const body = suggestionsBody();
  assert.match(body, /regexp_replace\(\$\{s\.shipments\.blNumber\}[^`]*ilike/);
  assert.match(body, /regexp_replace\(\$\{s\.shipments\.bookingRef\}[^`]*ilike/);
  // Hai nhánh cùng sống trong một or() — bỏ nhánh booking là regression.
  const orBlock = body.slice(body.indexOf('or('), body.indexOf(') as SQL,'));
  assert.match(orBlock, /blNumber/);
  assert.match(orBlock, /bookingRef/);
});

test('SIL-735 — luật đuôi `right(...) = digits` cũ đã gỡ (thay bằng substring)', () => {
  assert.doesNotMatch(suggestionsBody(), /right\(regexp_replace/);
});
