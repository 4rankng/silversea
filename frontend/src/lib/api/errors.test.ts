// Regression lock for the user-facing error text (user report 2026-09-18): a
// five-container lot with blank "Loại container" rendered
// "containers.containerTypeId: Loại container là bắt buộc" five times in the
// save banner. Three separate faults — raw path fallback, no grouping, and Zod's
// English vocabulary passing through — so each is pinned here.
import { describe, expect, it } from 'vitest';
import { formatErrorMessage } from './errors';

const issue = (path: Array<string | number>, message: string) => ({ code: 'custom', path, message });

describe('formatErrorMessage — no internal vocabulary on screen', () => {
  it('never prints an internal field path, and groups one sentence across its rows', () => {
    const body = {
      error: 'containers.0.containerTypeId',
      details: [0, 1, 2, 3, 4].map((index) => issue(['containers', index, 'containerTypeId'], 'Loại container là bắt buộc')),
    };
    const message = formatErrorMessage(body);

    expect(message).toBe('Container 1, 2, 3, 4, 5: Loại container là bắt buộc');
    expect(message).not.toContain('containers');
    expect(message).not.toContain('containerTypeId');
  });

  it('keeps one row label for a single failing container and separates distinct sentences', () => {
    const body = {
      details: [
        issue(['containers', 2, 'containerTypeId'], 'Loại container là bắt buộc'),
        issue(['containers', 0, 'routeId'], 'Tuyến đường là bắt buộc'),
        issue(['customerId'], 'Khách hàng là bắt buộc'),
      ],
    };

    expect(formatErrorMessage(body))
      .toBe('Container 3 — Loại container là bắt buộc; Container 1 — Tuyến đường là bắt buộc; Khách hàng là bắt buộc');
  });

  it('keeps the trip-form row prefix and its field label', () => {
    const body = { details: [issue(['legs', 1, 'km'], 'Number must be greater than 0')] };
    expect(formatErrorMessage(body)).toBe('Chặng 2 — Số km: Giá trị phải lớn hơn 0');
  });

  it('replaces Zod English phrasing and unlabeled paths with a generic Vietnamese sentence', () => {
    expect(formatErrorMessage({ details: [issue(['containers', 0, 'containerTypeId'], 'Expected number, received nan')] }))
      .toBe('Container 1 — Giá trị không hợp lệ');
    expect(formatErrorMessage({ details: [issue(['someInternalField', 'deeper'], 'Invalid input')] }))
      .toBe('Giá trị không hợp lệ');
  });

  it('never dumps a raw body object and still reports a plain string as-is', () => {
    expect(formatErrorMessage({ error: { code: 'X', internal: true } })).toBe('Giá trị không hợp lệ');
    expect(formatErrorMessage({ error: { message: 'Không thể khóa lô.' } })).toBe('Không thể khóa lô.');
    expect(formatErrorMessage({ error: 'Không thể lưu lô hàng.' })).toBe('Không thể lưu lô hàng.');
    expect(formatErrorMessage(undefined)).toBe('Lỗi không xác định');
  });
});
