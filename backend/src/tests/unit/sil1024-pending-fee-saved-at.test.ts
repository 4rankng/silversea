// SIL-1024 (K6.24) — phí chờ duyệt phải hiện ĐỎ kèm GIỜ LƯU (HH:MM) để đối
// soát. Regression context (staging, lô 1225 QA4B-2511-01): dòng 'Đảo vỏ'
// 100.000₫ render đỏ đúng (debit-merge-cell__line--pending) nhưng toàn trang
// không có giờ lưu nào — ops_expense_entries.created_at có sẵn trong DB nhưng
// không bao giờ lên wire. Luật mới: dòng chờ duyệt mang savedAt (ISO instant
// từ created_at), dòng đã duyệt KHÔNG mang (không cần đối soát stamp, wire
// giữ gọn); grid render ' · HH:MM' cạnh tên phí.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDebitMergeChiHo,
  buildDebitMergeNoInvoice,
} from '../../services/debit-merge.service';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '../../services/debit-merge.service.ts'), 'utf8');
const schemaSource = readFileSync(
  join(here, '../../../../shared/src/schemas/debit-merge.ts'),
  'utf8',
);

describe('SIL-1024 — savedAt chỉ đi trên dòng phí chờ duyệt', () => {
  const iso = '2026-11-25T08:30:00.000Z';

  test('group 4: dòng chờ duyệt mang savedAt, đã duyệt không mang', () => {
    const chiHo = buildDebitMergeChiHo([
      { category: 'KHAC', charge: null, paid: '100000', feeName: 'Đảo vỏ', invoiceNumber: null, pending: true, savedAt: iso },
      { category: 'KHAC', charge: null, paid: '200000', feeName: 'Đóng hàng', invoiceNumber: '123', pending: false, savedAt: iso },
    ]);
    assert.equal(chiHo.other[0].pending, true);
    assert.equal(chiHo.other[0].savedAt, iso);
    assert.equal(chiHo.other[1].pending, undefined);
    assert.equal(chiHo.other[1].savedAt, undefined);
  });

  test('group 4: chờ duyệt mà thiếu stamp thì không tự bịa giờ', () => {
    const chiHo = buildDebitMergeChiHo([
      { category: 'KHAC', charge: null, paid: '100000', feeName: 'Đảo vỏ', invoiceNumber: null, pending: true },
    ]);
    assert.equal(chiHo.other[0].savedAt, undefined);
  });

  test('group 5: dòng chờ duyệt mang savedAt, dòng thường không', () => {
    const no = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_INCIDENTAL', charge: null, paid: '100000', feeName: 'Đảo vỏ', pending: true, savedAt: iso },
      { costGroup: 'OPS_REGULAR', charge: null, paid: '450000', feeName: 'Chọn vỏ', pending: false },
    ]);
    const daoVo = no.fees.find((fee) => fee.name === 'Đảo vỏ');
    const chonVo = no.fees.find((fee) => fee.name === 'Chọn vỏ');
    assert.equal(daoVo?.pending, true);
    assert.equal(daoVo?.savedAt, iso);
    assert.equal(chonVo?.pending, undefined);
    assert.equal(chonVo?.savedAt, undefined);
  });

  test('chất liệu dây truyền: opsRows select created_at, wire map và schema đều có savedAt', () => {
    assert.match(serviceSource, /createdAt: s\.opsExpenseEntries\.createdAt/);
    assert.match(serviceSource, /const savedAt = pending && row\.createdAt != null \? row\.createdAt\.toISOString\(\) : null/);
    assert.match(serviceSource, /pending: fee\.pending, savedAt: fee\.savedAt/);
    assert.match(schemaSource, /savedAt: z\.iso\.datetime\(\)\.nullable\(\)\.optional\(\)/);
  });
});
