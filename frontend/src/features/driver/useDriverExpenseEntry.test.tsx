// SIL-1035 (KB K4.49 §4.2.8) — the driver expense entry surfaces offline
// failures as the one Vietnamese sentence ('Mất kết nối. Vui lòng thử lại.'),
// never as engine English ('NetworkError when attempting to fetch resource.'),
// and server refusals stay verbatim (only the network layer is normalized).
// The failed save keeps the draft rows so a retry re-sends the same content.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';

const api = vi.hoisted(() => ({
  listIncidentalCosts: vi.fn(),
  createIncidentalCosts: vi.fn(),
  uploadReceiptPhoto: vi.fn(),
}));
vi.mock('../../api/driverClient', () => ({ driverClient: api }));

import { useDriverExpenseEntry } from './useDriverExpenseEntry';

const OFFLINE = 'Mất kết nối. Vui lòng thử lại.';
const offline = () => new TypeError('NetworkError when attempting to fetch resource.');

describe('useDriverExpenseEntry — SIL-1035 offline mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refresh: a fetch TypeError becomes the offline sentence, never engine English', async () => {
    api.listIncidentalCosts.mockRejectedValue(offline());
    const { result } = renderHook(() => useDriverExpenseEntry(42, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe(OFFLINE);
    expect(result.current.loadError).not.toContain('NetworkError');
  });

  it('save: a fetch TypeError keeps the draft and shows the offline sentence', async () => {
    api.listIncidentalCosts.mockResolvedValue([]);
    api.createIncidentalCosts.mockRejectedValue(offline());
    const { result } = renderHook(() => useDriverExpenseEntry(42, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.patch({ amount: 50000 }));
    await act(async () => { result.current.save({ preventDefault: () => undefined } as unknown as React.FormEvent); });

    await waitFor(() => expect(result.current.error).toBe(OFFLINE));
    expect(result.current.error).not.toContain('NetworkError');
    // Nothing lost — the row survives for a deliberate retry (K4.49 §4.2.8).
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].amount).toBe(50000);
  });

  it('save: a server refusal stays verbatim — only the network layer is normalized', async () => {
    api.listIncidentalCosts.mockResolvedValue([]);
    api.createIncidentalCosts.mockRejectedValue(new ApiError(500, { error: 'Máy chủ bận' }, 'Máy chủ bận'));
    const { result } = renderHook(() => useDriverExpenseEntry(42, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.patch({ amount: 50000 }));
    await act(async () => { result.current.save({ preventDefault: () => undefined } as unknown as React.FormEvent); });

    await waitFor(() => expect(result.current.error).toBe('Máy chủ bận'));
  });
});

// SIL-1132 — the draft row carries the Hóa đơn/Phiếu thu choice: the DEFAULT
// is the SIL-759 catalog derivation (INVOICED ⇒ INVOICE, else RECEIPT), a fee
// re-pick re-derives it, and the driver's override is what the create body
// sends.
describe('useDriverExpenseEntry — SIL-1132 evidence-kind default and override', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the blank draft preselects the catalog derivation and a fee re-pick re-derives the default', async () => {
    api.listIncidentalCosts.mockResolvedValue([]);
    const { result } = renderHook(() => useDriverExpenseEntry(42, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // 'lift' (Phí nâng — LIFTING, catalog-invoiced) derives Hóa đơn…
    expect(result.current.drafts[0].evidenceKind).toBe('INVOICE');
    // …a no-invoice pick re-derives the default (Phiếu thu)…
    act(() => result.current.chooseOption('weld'));
    expect(result.current.drafts[0].evidenceKind).toBe('RECEIPT');
    // …and an invoiced pick (Phí lưu kho — FEE_WAREHOUSE) derives Hóa đơn again.
    act(() => result.current.chooseOption('warehouse'));
    expect(result.current.drafts[0].evidenceKind).toBe('INVOICE');
  });

  it("the driver's tick overrides the derivation and the create body carries the chosen kind", async () => {
    api.listIncidentalCosts.mockResolvedValue([]);
    api.createIncidentalCosts.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useDriverExpenseEntry(42, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.patch({ amount: 50000, evidenceKind: 'RECEIPT' }));
    expect(result.current.drafts[0].evidenceKind).toBe('RECEIPT');
    await act(async () => { result.current.save({ preventDefault: () => undefined } as unknown as React.FormEvent); });

    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ evidenceKind: 'RECEIPT', expenseTypeCode: 'LIFTING', amount: 50000 });
  });
});
