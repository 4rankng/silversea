import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { disconnectRedis, getRedis, invalidateReportCaches } from '../lib/redis';

const dashboardKeys = ['reports:dashboard', 'reports:dashboard:executive'] as const;

after(async () => {
  await getRedis().del(...dashboardKeys);
  await disconnectRedis();
});

describe('shared financial report cache invalidation', () => {
  test('clears both base and executive dashboard variants', async () => {
    const redis = getRedis();
    await redis.mset(
      dashboardKeys[0], JSON.stringify({ marker: 'base' }),
      dashboardKeys[1], JSON.stringify({ marker: 'executive' }),
    );

    await invalidateReportCaches();

    assert.deepEqual(await redis.mget(...dashboardKeys), [null, null]);
  });
});
