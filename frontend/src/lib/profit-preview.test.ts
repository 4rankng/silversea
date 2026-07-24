import { describe, expect, it } from 'vitest';
import { getProfitPreviewEmptyMessage } from './profit-preview';

describe('getProfitPreviewEmptyMessage', () => {
  it('returns a clear empty state for a zero-trip preview', () => {
    expect(getProfitPreviewEmptyMessage({
      tripCount: 0,
      distributions: [],
      entity: [],
      undistributedProfit: 0,
    })).toBe('Chưa có chuyến đã khóa trong quý này để phân phối.');
  });

  it('does not show an empty state when there are distribution rows', () => {
    expect(getProfitPreviewEmptyMessage({
      tripCount: 1,
      distributions: [{ partnerName: 'A' }],
      entity: [],
    })).toBeNull();
  });
});
