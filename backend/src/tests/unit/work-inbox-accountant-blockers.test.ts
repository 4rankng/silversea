// SIL-726 (spec fix 2 07/11 §II.1): lane kế toán trên Tổng quan Kế toán chỉ
// còn chặn bởi hoàn thiện khoản chi + quyết toán tạm ứng. e-POD là tùy chọn
// (quyết định 22/10 — 0 ảnh vẫn hoàn thành) và ảnh chụp lợi nhuận backend tự
// sinh ngầm khi chốt (captureProfitabilityAttributionSnapshot), nên cả hai
// không được xuất hiện làm blocker trên inbox. financialWorkInbox dính db nên
// unit test scan nguồn thay vì import (house pattern: debit-note-live-bks).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/work-inbox.service.ts'), 'utf8');

function inboxBody(): string {
  const start = source.indexOf('export async function financialWorkInbox');
  const end = source.indexOf('export async function managerDecisionInbox');
  assert.ok(start > 0 && end > start, 'financialWorkInbox body not found');
  return source.slice(start, end);
}

test('SIL-726 — lane kế toán không còn blocker POD (e-POD tùy chọn từ 22/10)', () => {
  assert.doesNotMatch(inboxBody(), /code: 'POD'/);
  assert.doesNotMatch(inboxBody(), /Chưa có e-POD hợp lệ/);
});

test('SIL-726 — lane kế toán không còn blocker PROFITABILITY (snapshot tự sinh khi chốt)', () => {
  assert.doesNotMatch(inboxBody(), /code: 'PROFITABILITY'/);
  assert.doesNotMatch(inboxBody(), /Thiếu ảnh chụp lợi nhuận hiện hành/);
});

test('SIL-726 — khoản chi + quyết toán tạm ứng vẫn là 2 blocker thật', () => {
  assert.match(inboxBody(), /code: 'EXPENSE_APPROVAL'/);
  assert.match(inboxBody(), /code: 'SETTLEMENT'/);
});

test('SIL-726 — cờ thông tin POD/snapshot vẫn tính cho dải facts (không chặn)', () => {
  const body = inboxBody();
  assert.match(body, /acceptedPodReady/);
  assert.match(body, /profitabilitySnapshotReady/);
});
