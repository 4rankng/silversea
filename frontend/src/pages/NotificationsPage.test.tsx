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
});
