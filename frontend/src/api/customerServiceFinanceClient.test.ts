import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, getBlobMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), getBlobMock: vi.fn(), postMock: vi.fn() }));

vi.mock('../lib/api', () => ({ api: { get: getMock, getBlob: getBlobMock, post: postMock } }));

import { customerServiceFinanceClient } from './customerServiceFinanceClient';

describe('customerServiceFinanceClient', () => {
  beforeEach(() => { getMock.mockReset(); getBlobMock.mockReset(); postMock.mockReset(); });

  it('keeps the recoverable-cost list bounded and forwards server filters', async () => {
    getMock.mockResolvedValue({ items: [], total: 0, page: 2, limit: 25 });
    await customerServiceFinanceClient.listRecoverableCosts({ page: 2, limit: 25, approvalStatus: 'PENDING' });
    expect(getMock).toHaveBeenCalledWith('/recoverable-costs?page=2&limit=25&approvalStatus=PENDING');
  });

  it('uses the required idempotency header for a recoverable-cost request', async () => {
    postMock.mockResolvedValue({ id: 7 });
    await customerServiceFinanceClient.requestRecoverableCost(12, {
      decision: 'APPROVED', reason: 'Đủ chứng từ', expectedVersion: 3,
      evidence: { reviewNote: 'Đủ chứng từ', attachmentRefs: [] },
    }, 'request-key-12');
    expect(postMock).toHaveBeenCalledWith(
      '/recoverable-costs/12/request',
      expect.objectContaining({ expectedVersion: 3 }),
      { headers: { 'Idempotency-Key': 'request-key-12' } },
    );
  });

  it('queries the canonical treasury and profitability reports', async () => {
    getMock.mockResolvedValue({});
    await customerServiceFinanceClient.getTreasuryPosition();
    await customerServiceFinanceClient.getProfitability({ month: 7, year: 2026, dimension: 'TRUCK' });
    expect(getMock).toHaveBeenNthCalledWith(1, '/finance/treasury/position');
    expect(getMock).toHaveBeenNthCalledWith(2, '/reports/profitability?month=7&year=2026&dimension=TRUCK&page=1&limit=50');
  });

  it('keeps the low-margin filter identical for screen and export', async () => {
    getMock.mockResolvedValue({});
    getBlobMock.mockResolvedValue(new Blob());
    await customerServiceFinanceClient.getProfitability({
      month: 8, year: 2026, dimension: 'CUSTOMER', lowMarginOnly: true,
    });
    await customerServiceFinanceClient.exportProfitability({
      month: 8, year: 2026, dimension: 'CUSTOMER', lowMarginOnly: true,
    });
    expect(getMock).toHaveBeenCalledWith('/reports/profitability?month=8&year=2026&dimension=CUSTOMER&page=1&limit=50&alert=LOW_MARGIN');
    expect(getBlobMock).toHaveBeenCalledWith('/reports/profitability/export?month=8&year=2026&dimension=CUSTOMER&alert=LOW_MARGIN');
  });
});
