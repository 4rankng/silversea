import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { actionErrorMessage, isAbortedOrRaced } from './action-error';

/**
 * Card 071026212000 (lead ruling 2026-10-08) — pin the toast-policy semantics
 * every swept error→toast mapping relies on. `actionErrorMessage` returns
 * null when nothing may be toasted; the ONLY permission copy that may reach a
 * toast names the action.
 */
describe('actionErrorMessage — permission toast policy', () => {
  it('a genuine 403 permission body names the action', () => {
    const denied = new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập');
    expect(actionErrorMessage('xóa khách hàng', denied, 'Lỗi xóa'))
      .toBe('Bạn không có quyền xóa khách hàng.');
  });

  it('every backend denial-body variant collapses to the named action', () => {
    // casbin.ts:26/60/87, ocr.ts:229, ops.ts:297, upload.ts, advances.ts …
    for (const body of [
      'Không có quyền truy cập',
      'Không có quyền truy cập ảnh này',
      'Không có quyền xóa ảnh cho chuyến đi này',
      'Không có quyền truy cập.',
    ]) {
      const denied = new ApiError(403, { error: body }, body);
      expect(actionErrorMessage('tải ảnh', denied, 'Lỗi tải ảnh'))
        .toBe('Bạn không có quyền tải ảnh.');
    }
  });

  it('a 403 business refusal is NOT a permission denial — stays verbatim', () => {
    // use-trip-form-submit.ts:582-586 depends on this class surviving intact.
    const refusal = 'Khách hàng đã vượt hạn mức tín dụng';
    const err = new ApiError(403, { error: refusal }, refusal);
    expect(actionErrorMessage('lưu chuyến', err, 'Lỗi lưu')).toBe(refusal);
  });

  it('a permission-shaped message on a NON-403 is an error-shape collision — fallback wins', () => {
    for (const status of [200, 401, 500]) {
      const collision = new ApiError(status, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập');
      expect(actionErrorMessage('cập nhật', collision, 'Lỗi cập nhật')).toBe('Lỗi cập nhật');
    }
  });

  it('aborted/raced errors toast NOTHING (null)', () => {
    expect(actionErrorMessage('cập nhật', new DOMException('The user aborted a request', 'AbortError'), 'Lỗi'))
      .toBeNull();
    expect(actionErrorMessage('cập nhật', new Error('signal is aborted without reason'), 'Lỗi'))
      .toBeNull();
  });

  it('ordinary errors keep today\'s behavior: server message, then fallback', () => {
    const conflict = new ApiError(409, { error: 'Dữ liệu đã thay đổi' }, 'Dữ liệu đã thay đổi');
    expect(actionErrorMessage('cập nhật', conflict, 'Lỗi cập nhật')).toBe('Dữ liệu đã thay đổi');
    expect(actionErrorMessage('cập nhật', new Error(''), 'Lỗi cập nhật')).toBe('Lỗi cập nhật');
    expect(actionErrorMessage('cập nhật', 'plain throw', 'Lỗi cập nhật')).toBe('Lỗi cập nhật');
  });

  it('classifies aborts for the whole sweep', () => {
    expect(isAbortedOrRaced(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortedOrRaced(new Error('The user aborted a request'))).toBe(true);
    expect(isAbortedOrRaced(new ApiError(403, null, 'Không có quyền truy cập'))).toBe(false);
  });
});
