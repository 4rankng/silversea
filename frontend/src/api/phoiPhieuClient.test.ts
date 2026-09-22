import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('../lib/api', () => ({ api: { get: getMock, post: postMock } }));

import { correctPhoiPhieuRow } from './phoiPhieuClient';

describe('phoiPhieuClient — correct-row contract', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('20260922_2: correct body carries only editable fields, never tripId', async () => {
    postMock.mockResolvedValue({});
    const payload = {
      expectedVersion: 1,
      reason: 'Kế toán sửa số tiền trong xem chi tiết chi hộ',
      amount: 260000,
      customerChargeAmount: 120000,
    };
    await correctPhoiPhieuRow(14, payload);
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]!;
    expect(url).toBe('/expense-accounting/entries/OPS/14/correct');
    // The correction guard 400s on any tripId — the corrected money fields
    // must ride alone (confirmed dialog rows could never save before).
    expect(body).toEqual(payload);
    expect(JSON.stringify(body)).not.toContain('tripId');
  });
});
