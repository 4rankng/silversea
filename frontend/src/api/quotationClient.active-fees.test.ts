// Card _64 Phase A — the client speaks to the active-fees endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { quotationClient } from './quotationClient';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

describe('quotationClient.getActiveFees (card _64 Phase A)', () => {
  beforeEach(() => apiGet.mockReset());

  it('GETs the customer-scoped catalog and returns items', async () => {
    apiGet.mockResolvedValue({ items: [{ id: 1, feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: 500000, routing: 'OTHER_COSTS', note: null, sortOrder: 0 }] });
    const result = await quotationClient.getActiveFees(41);
    expect(apiGet).toHaveBeenCalledWith('/quotations/fees/active?customerId=41');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].routing).toBe('OTHER_COSTS');
  });
});
