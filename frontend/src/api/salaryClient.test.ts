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
});
