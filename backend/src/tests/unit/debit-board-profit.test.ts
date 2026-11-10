// SIL-771 — Bảng Kiểm soát lô hàng: công thức lợi nhuận khách chốt 09/11/2026
// Lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài. Thay công thức cũ
// 'Tổng thu − Tổng 1 − Phí RU' (KB Ch.6 §6.3) theo quyết định của Frank
// ('khách hàng bảo thế nào thì làm thế'); Phí RU còn hiển thị nhưng không
// còn trừ riêng. Pure arithmetic — no db, no app boot (BE unit-only law).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDebitBoardProfit } from '../../services/accounting-debit-close.service';

describe('computeDebitBoardProfit (SIL-771)', () => {
  it('trừ đúng Tổng thu − Tổng trả khi chưa nhập chi phí ngoài (null = 0, không phải null)', () => {
    assert.equal(computeDebitBoardProfit('1790000', '480000', null), '1310000');
  });

  it('trừ thêm Chi phí ngoài khi đã nhập', () => {
    assert.equal(computeDebitBoardProfit('1790000', '480000', '50000'), '1260000');
  });

  it('lợi nhuận âm giữ nguyên dấu (ô đỏ là việc của hiển thị)', () => {
    assert.equal(computeDebitBoardProfit('100000', '480000', '50000'), '-430000');
  });

  it('vẫn null khi Tổng thu chưa xác định (hàng tự động còn thiếu)', () => {
    assert.equal(computeDebitBoardProfit(null, '480000', '50000'), null);
  });

  it('vẫn null khi Tổng trả chưa xác định', () => {
    assert.equal(computeDebitBoardProfit('1790000', null, null), null);
  });

  it('không còn trừ Phí RU riêng (giá trị RU chỉ là hiển thị)', () => {
    // Quy tắc cũ: 1790000 − 480000 − 150000(RU). Quy tắc mới: RU nằm ngoài
    // công thức — chi phí ngoài chỉ là trường kế toán nhập.
    assert.equal(computeDebitBoardProfit('1790000', '480000', null), '1310000');
  });
});
