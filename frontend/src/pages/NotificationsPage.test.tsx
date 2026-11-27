import { describe, expect, it } from 'vitest';
import { notificationDisplayMessage } from '../lib/notificationText';

describe('notificationDisplayMessage', () => {
  it('strips the internal trip code the backend composes into the message', () => {
    expect(notificationDisplayMessage('Chuyến TRP-202609-0001 đã được điều xe'))
      .toBe('Chuyến đã được điều xe');
  });

  it('strips every internal code in the message', () => {
    expect(notificationDisplayMessage('Chuyến TRP-202609-0001 đã hoàn thành và TRP-202609-0002 đã hủy'))
      .toBe('Chuyến đã hoàn thành và đã hủy');
  });

  it('leaves a message without an internal code untouched', () => {
    expect(notificationDisplayMessage('Khách hàng ABC có lịch nhắc công nợ'))
      .toBe('Khách hàng ABC có lịch nhắc công nợ');
  });

  // P2-17 (audit 2026-11-27): notification TITLES render through the same
  // display pass as messages (/notifications item-title) — a title carrying
  // an internal code strips it identically.
  it('strips an internal code from a title the same way — including one inside parentheses', () => {
    expect(notificationDisplayMessage('Điều xe (TRP-2026-10-0028)')).not.toContain('TRP-');
    expect(notificationDisplayMessage('Chuyến TRP-2026-10-0028 đã được tạo'))
      .toBe('Chuyến đã được tạo');
  });

  // Card 261022201006c: the app lái xe shows no raw internal code, and the
  // notification copy a driver reads (bell dropdown + /notifications) is one
  // of those surfaces. The strip must cover EVERY code shape the platform
  // stores — a narrow "TRP-\d{6}-\d+" regex let the seeded, legacy and
  // shipment-code shapes through verbatim.
  it('strips every internal code shape the platform stores', () => {
    expect(notificationDisplayMessage('Chuyến TRP-2026-10-0028 đã được tạo'))
      .toBe('Chuyến đã được tạo');
    expect(notificationDisplayMessage('Chuyến TRP-C12-53-1791212851260-gvr4vb đã được tạo'))
      .toBe('Chuyến đã được tạo');
    expect(notificationDisplayMessage('Chuyến BULK-TR-0011 đã được điều xe'))
      .toBe('Chuyến đã được điều xe');
    expect(notificationDisplayMessage('Chuyến CN-MSCU1234561-1 đã được tạo'))
      .toBe('Chuyến đã được tạo');
    expect(notificationDisplayMessage('Lô SHP-2610-00069 đã được điều xe'))
      .toBe('Lô đã được điều xe');
  });

  it('keeps the business reference and address copy in the message', () => {
    expect(notificationDisplayMessage('Chuyến BL-2026-001 đã được điều xe'))
      .toBe('Chuyến BL-2026-001 đã được điều xe');
    expect(notificationDisplayMessage('Kho tại Lô CN-09, KCN Vân Trung'))
      .toBe('Kho tại Lô CN-09, KCN Vân Trung');
  });

  // SIL-1205 (audit 2026-11-27): the port-change notification shipped the raw
  // column key — "Cảng/bãi "Cảng Tân Vũ" vừa thay đổi (name)." The backend
  // source is fixed (it names the changed field in business words); this pass
  // is the defence in depth for a row ALREADY stored with the placeholder —
  // it must read as a sentence, never as a template key.
  it('drops an unsubstituted template placeholder instead of leaking the key', () => {
    expect(notificationDisplayMessage('Cảng/bãi "Cảng Tân Vũ" vừa thay đổi (name).'))
      .toBe('Cảng/bãi "Cảng Tân Vũ" vừa thay đổi.');
    expect(notificationDisplayMessage('Cảng/bãi "Cảng Tân Vũ" vừa thay đổi (code). Chuyến TRP-202609-0001 của bạn.'))
      .toBe('Cảng/bãi "Cảng Tân Vũ" vừa thay đổi. Chuyến của bạn.');
  });

  it('renders the legacy staging row as a readable sentence', () => {
    expect(notificationDisplayMessage(
      'Cảng/bãi "Cảng Tân Vũ" vừa thay đổi (name). Chuyến TRP-202609-0001 của bạn tham chiếu cảng này — kiểm tra lại địa điểm nâng/hạ trước khi chạy.',
    )).toBe(
      'Cảng/bãi "Cảng Tân Vũ" vừa thay đổi. Chuyến của bạn tham chiếu cảng này — kiểm tra lại địa điểm nâng/hạ trước khi chạy.',
    );
  });

  it('drops every template-key shape, not only the key this ticket saw', () => {
    expect(notificationDisplayMessage('Thay đổi (driverName) lúc (time)'))
      .toBe('Thay đổi lúc');
    expect(notificationDisplayMessage('(name)')).toBe('');
  });

  it('keeps business copy that carries parentheses', () => {
    expect(notificationDisplayMessage('Phí (USD) đã cập nhật'))
      .toBe('Phí (USD) đã cập nhật');
    expect(notificationDisplayMessage('Lô (đã quá hạn) cần xử lý'))
      .toBe('Lô (đã quá hạn) cần xử lý');
    expect(notificationDisplayMessage('Tải trọng (tấn) đã ghi nhận'))
      .toBe('Tải trọng (tấn) đã ghi nhận');
  });
});
