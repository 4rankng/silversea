import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { salaryClient } from './salaryClient';

describe('salary governance route contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads driver and period governance history from the mounted API route', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);

    await salaryClient.listDriverGovernanceActions(7, 2026, 7);
    await salaryClient.listPeriodGovernanceActions('2026-07');

    expect(get).toHaveBeenCalledTimes(4);
    for (const [path] of get.mock.calls) {
      expect(path).toMatch(/^\/governance-actions\?/);
      expect(path).not.toContain('/finance/governance-actions');
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('limit')).toBe('100');
      expect(query.get('subjectKey')).toMatch(/^(7:2026-07|2026-07)$/);
    }

    expect(get.mock.calls.slice(0, 2).map(([path]) => new URLSearchParams(path.split('?')[1]).get('subjectKey')))
      .toEqual(['7:2026-07', '7:2026-07']);
    expect(get.mock.calls.slice(2).map(([path]) => new URLSearchParams(path.split('?')[1]).get('subjectKey')))
      .toEqual(['2026-07', '2026-07']);
  });

  it('submits the displayed version when checking and approving a post-close adjustment', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});

    await salaryClient.checkPostCloseAdjustment('2026-07', 41, 3);
    await salaryClient.approvePostCloseAdjustment('2026-07', 41, 4);

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/salary/periods/2026-07/adjustments/41/check',
      { expectedVersion: 3 },
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/salary/periods/2026-07/adjustments/41/approve',
      { expectedVersion: 4 },
    );
  });

  it('uses period-bound routes for governed salary issue and official posting decisions', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});

    await salaryClient.checkIssuePayslips('2026-07', 51, 1);
    await salaryClient.approveIssuePayslips('2026-07', 51, 2);
    await salaryClient.checkPostOfficial('2026-07', 52, 1);
    await salaryClient.approvePostOfficial('2026-07', 52, 2);

    expect(post.mock.calls).toEqual([
      ['/salary/periods/2026-07/issue-actions/51/check', { expectedVersion: 1 }],
      ['/salary/periods/2026-07/issue-actions/51/approve', { expectedVersion: 2 }],
      ['/salary/periods/2026-07/post-actions/52/check', { expectedVersion: 1 }],
      ['/salary/periods/2026-07/post-actions/52/approve', { expectedVersion: 2 }],
    ]);
  });
});
