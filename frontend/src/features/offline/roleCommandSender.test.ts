import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { classifyOfflineCommandError } from './roleCommandSender';

describe('classifyOfflineCommandError', () => {
  it('retries only transport and 5xx failures', () => {
    expect(classifyOfflineCommandError(new TypeError('offline'))).toMatchObject({ ok: false, kind: 'network' });
    expect(classifyOfflineCommandError(new ApiError(503, null, 'Tạm gián đoạn'))).toMatchObject({ ok: false, kind: 'network' });
  });

  it('stops version conflicts and makes other 4xx responses terminal', () => {
    expect(classifyOfflineCommandError(new ApiError(409, null, 'Phiên bản đã đổi'))).toMatchObject({ ok: false, kind: 'conflict' });
    expect(classifyOfflineCommandError(new ApiError(422, null, 'Dữ liệu không hợp lệ'))).toMatchObject({ ok: false, kind: 'rejected' });
    expect(classifyOfflineCommandError(new ApiError(403, null, 'Không có quyền'))).toMatchObject({ ok: false, kind: 'rejected' });
  });
});
