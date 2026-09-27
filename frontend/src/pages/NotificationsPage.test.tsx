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
});
