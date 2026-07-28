import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { financialClient, type FuelInvoice } from './financialClient';

describe('fuel invoice list compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opts into cursor pagination and preserves the array client contract', async () => {
    const firstInvoice = { id: 101 } as FuelInvoice;
    const secondInvoice = { id: 100 } as FuelInvoice;
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({
        items: [firstInvoice],
        nextCursor: 'cursor-100',
      })
      .mockResolvedValueOnce({
        items: [secondInvoice],
        nextCursor: null,
      });

    const result = await financialClient.getFuelInvoices({
      supplierId: 7,
      status: 'APPROVED',
    });

    expect(result).toEqual([firstInvoice, secondInvoice]);
    expect(get).toHaveBeenCalledTimes(2);
    for (const [path] of get.mock.calls) {
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('paginated')).toBe('true');
      expect(query.get('limit')).toBe('100');
    }
    expect(new URLSearchParams(get.mock.calls[0]![0].split('?')[1]).get('cursor')).toBeNull();
    expect(new URLSearchParams(get.mock.calls[1]![0].split('?')[1]).get('cursor')).toBe('cursor-100');
  });
});
