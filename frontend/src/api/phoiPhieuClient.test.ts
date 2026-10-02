import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock('../lib/api', () => ({ api: { get: getMock, post: postMock } }));

import { correctPhoiPhieuRow, getPhoiPhieuChiHo, listPhoiPhieuRows } from './phoiPhieuClient';
import { qk } from './keys';

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

  it('PHOI05 keys and read requests preserve omitted ALL and isolate confirmation scopes', async () => {
    getMock.mockResolvedValue({});
    await getPhoiPhieuChiHo(196);
    await getPhoiPhieuChiHo(196, 'CONFIRMED');
    await getPhoiPhieuChiHo(196, 'UNCONFIRMED');
    expect(getMock.mock.calls.slice(0, 3).map(call => call[0])).toEqual([
      '/expense-accounting/phoi-phieu/196/chi-ho', '/expense-accounting/phoi-phieu/196/chi-ho?confirmation=CONFIRMED', '/expense-accounting/phoi-phieu/196/chi-ho?confirmation=UNCONFIRMED',
    ]);
    await listPhoiPhieuRows({ confirmation: 'CONFIRMED', search: 'QA22-OPS-INV' });
    expect(new URL(getMock.mock.calls[3][0], 'http://localhost').searchParams.get('confirmation')).toBe('CONFIRMED');
    expect(qk.phoiPhieu.chiHo(196)).toEqual(['phoi-phieu-chi-ho', 196]);
    expect(qk.phoiPhieu.chiHo(196, 'CONFIRMED')).not.toEqual(qk.phoiPhieu.chiHo(196, 'UNCONFIRMED'));
    expect(postMock).not.toHaveBeenCalled();
  });
});
