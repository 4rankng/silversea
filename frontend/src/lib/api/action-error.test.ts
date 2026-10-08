import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { actionErrorMessage, backgroundErrorMessage, isAbortedOrRaced } from './action-error';

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

/**
 * Card 20261008_6 — describe passthrough (validation-message helper) and the
 * background mapping used by catches that can fire without a user gesture.
 */
describe('actionErrorMessage — describe passthrough (card 20261008_6)', () => {
  const gps = (error: unknown): string => {
    const message = error instanceof Error ? error.message : '';
    return message === 'geo-denied' ? 'Chưa được cấp quyền vị trí. Hãy cho phép GPS rồi chụp lại ảnh.' : '';
  };

  it('a site solver supplies the non-denial message (validation passthrough)', () => {
    expect(actionErrorMessage('tải ảnh chứng từ', new Error('geo-denied'), 'Không thể tải ảnh.', gps))
      .toBe('Chưa được cấp quyền vị trí. Hãy cho phép GPS rồi chụp lại ảnh.');
  });

  it('an empty solver result falls through to raw, then fallback', () => {
    expect(actionErrorMessage('tải ảnh', new Error(''), 'Không thể tải ảnh.', gps)).toBe('Không thể tải ảnh.');
    expect(actionErrorMessage('tải ảnh', new Error('Máy chủ bận'), 'Không thể tải ảnh.', gps)).toBe('Máy chủ bận');
  });

  it('a denial is named BEFORE the solver runs', () => {
    const denied = new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập');
    expect(actionErrorMessage('tải ảnh chứng từ', denied, 'Không thể tải ảnh.', gps))
      .toBe('Bạn không có quyền tải ảnh chứng từ.');
  });

  it('a solver may not smuggle permission copy through the back door', () => {
    const liar = () => 'Không có quyền truy cập';
    expect(actionErrorMessage('lưu', new Error('boom'), 'Lỗi lưu', liar)).toBe('Lỗi lưu');
    expect(backgroundErrorMessage(new Error('boom'), 'Lỗi tải', liar)).toBe('Lỗi tải');
  });
});

describe('backgroundErrorMessage — no user gesture, no named permission toast (card 20261008_6)', () => {
  it('a background permission body falls back to the degrade message, never the body, never a named action', () => {
    for (const status of [403, 500]) {
      const err = new ApiError(status, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập');
      expect(backgroundErrorMessage(err, 'Lỗi khi xem trước phân phối.')).toBe('Lỗi khi xem trước phân phối.');
    }
  });

  it('a background 403 business refusal stays verbatim (not permission copy)', () => {
    const refusal = 'Kỳ lợi nhuận đã bị khóa';
    const err = new ApiError(403, { error: refusal }, refusal);
    expect(backgroundErrorMessage(err, 'Lỗi khi xem trước.')).toBe(refusal);
  });

  it('aborted/raced background errors toast NOTHING (null)', () => {
    expect(backgroundErrorMessage(new DOMException('The user aborted a request', 'AbortError'), 'Lỗi')).toBeNull();
    expect(backgroundErrorMessage(new Error('signal is aborted without reason'), 'Lỗi')).toBeNull();
  });

  it('ordinary background errors keep the server reason, then fallback', () => {
    expect(backgroundErrorMessage(new Error('Máy chủ trả về phản hồi không hợp lệ'), 'Lỗi tải'))
      .toBe('Máy chủ trả về phản hồi không hợp lệ');
    expect(backgroundErrorMessage(new Error(''), 'Lỗi tải')).toBe('Lỗi tải');
    expect(backgroundErrorMessage('plain throw', 'Lỗi tải')).toBe('Lỗi tải');
  });
});
