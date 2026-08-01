import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({
  api: {
    get: getMock,
    post: vi.fn(),
  },
}));

import { creditOverrideClient } from './creditOverrideClient';

describe('creditOverrideClient paginated list contract', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({ items: [], limit: 25, hasMore: false, nextCursor: null });
  });

  it('sends the opaque cursor, page size, status, and customer filters together', async () => {
    await creditOverrideClient.listRequests({
      status: 'PENDING',
      customerId: 7,
      cursor: 'opaque-next-position',
      limit: 25,
    });

    const [path] = getMock.mock.calls[0] as [string];
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.split('?')[0]).toBe('/finance/credit-overrides');
    expect(Object.fromEntries(query)).toEqual({
      status: 'PENDING',
      customerId: '7',
      limit: '25',
      cursor: 'opaque-next-position',
    });
  });
});
