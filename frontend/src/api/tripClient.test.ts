import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post, put, remove } = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { post, put, delete: remove } }));

import { tripClient } from './tripClient';

describe('trip expense direct commands', () => {
  beforeEach(() => {
    post.mockReset();
    put.mockReset();
    remove.mockReset();
  });

  it('records and changes an expense through the source command without an approval handoff', async () => {
    const body = { expenseType: 'OTHER', buyAmount: 500000, sellAmount: 300000 };
    const expense = { id: 23, tripId: 7, ...body };
    post.mockResolvedValue(expense);
    put.mockResolvedValue({ ...expense, sellAmount: 0 });

    await expect(tripClient.createTripExpense(7, body)).resolves.toEqual(expense);
    expect(post).toHaveBeenCalledExactlyOnceWith('/trips/7/expenses', body);
    await expect(tripClient.updateTripExpense(7, 23, { sellAmount: 0 })).resolves.toEqual({ ...expense, sellAmount: 0 });
    expect(put).toHaveBeenCalledExactlyOnceWith('/trips/7/expenses/23', { sellAmount: 0 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps direct deletion and exposes no retired approve or reject operation', async () => {
    remove.mockResolvedValue({ ok: true });
    await expect(tripClient.deleteTripExpense(7, 23)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith('/trips/7/expenses/23');
    expect(tripClient).not.toHaveProperty('approveTripExpense');
    expect(tripClient).not.toHaveProperty('rejectTripExpense');
    expect(post).not.toHaveBeenCalled();
  });
});
