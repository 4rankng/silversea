import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { shouldLogoutForQueryError } from './useAuthedQuery';

describe('authenticated query session policy', () => {
  it('logs out only for an expired session, not a forbidden action', () => {
    expect(shouldLogoutForQueryError(new ApiError(401, null, 'Phiên đăng nhập hết hạn'))).toBe(true);
    expect(shouldLogoutForQueryError(new ApiError(403, null, 'Không có quyền'))).toBe(false);
    expect(shouldLogoutForQueryError(new Error('network'))).toBe(false);
  });
});
