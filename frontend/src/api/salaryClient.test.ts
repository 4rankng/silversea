import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { salaryClient } from './salaryClient';

describe('salary governance route contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits the displayed expectedVersion when creating a post-close adjustment', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});

    await salaryClient.requestPostCloseAdjustment('2026-07', {
      driverId: 41,
      targetPeriod: '2026-08',
      amount: 250000,
      reason: 'bổ sung công chuyến',
      expectedVersion: 3,
    });

    expect(post).toHaveBeenCalledWith('/salary/periods/2026-07/adjustments', {
      driverId: 41,
      targetPeriod: '2026-08',
      amount: 250000,
      reason: 'bổ sung công chuyến',
      expectedVersion: 3,
    });
  });

  it('posts governed period operations to their period-bound routes', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});

    await salaryClient.closePeriod('2026-07', 'chốt thử');
    await salaryClient.reopenPeriod('2026-07', { expectedVersion: 2, reason: 'cần sửa' });
    await salaryClient.issuePayslips('2026-07', { expectedVersion: 1 });
    await salaryClient.postOfficial('2026-07', { expectedVersion: 2 });
    await salaryClient.confirmSalary(7, 2026, 7);
    await salaryClient.unconfirmSalary(7, 2026, 7, 'cần sửa ngày công');

    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/salary/periods/2026-07/close',
      '/salary/periods/2026-07/reopen',
      '/salary/periods/2026-07/issue',
      '/salary/periods/2026-07/post',
      '/salary/7/2026/7/confirm',
      '/salary/7/2026/7/unconfirm',
    ]);
  });
});
