import { act, render, screen, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceListResponse } from '@tingting/shared';
import { CUS_PAGE_SIZE, useCusWorkspaceState, type CusWorkspaceListParams } from './use-cus-workspace-state';

const listCusShipmentWorkspace = vi.hoisted(() => vi.fn());

vi.mock('../../../api/shipmentClient', () => ({
  listCusShipmentWorkspace,
  getCusShipmentWorkspaceDetail: vi.fn(),
}));

function listResponse(total: number): ShipmentCusWorkspaceListResponse {
  return {
    items: [],
    total,
    totalPages: 1,
    pageSummary: { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0 },
  } as unknown as ShipmentCusWorkspaceListResponse;
}

const baseParams: CusWorkspaceListParams = {
  page: 1,
  searchSuffix: '',
  transportDateFrom: '',
  transportDateTo: '',
  direction: '',
  bucket: '',
  sortKey: null,
  sortDir: 'asc',
};

let nextParams: CusWorkspaceListParams = { ...baseParams };

function Probe() {
  const ws = useCusWorkspaceState(nextParams);
  return (
    <div>
      <span data-testid="total">{ws.data?.total ?? 'none'}</span>
      <span data-testid="loading">{ws.loading ? 'yes' : 'no'}</span>
      <span data-testid="error">{ws.error ?? 'none'}</span>
      <button type="button" onClick={() => void ws.loadList()}>retry</button>
    </div>
  );
}

/** Mirrors the app-wide defaults from main.tsx so the per-query overrides
 * (30s poll, focus 'always') must win on their own merit — that is the
 * regression these tests lock in. */
function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, staleTime: 5 * 60 * 1000 } },
  });
}

function probeUi(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
}

describe('useCusWorkspaceState — list query equivalence', () => {
  let client: QueryClient;

  beforeEach(() => {
    listCusShipmentWorkspace.mockReset();
    nextParams = { ...baseParams };
    client = makeClient();
    focusManager.setFocused(true);
  });
  afterEach(() => { client.clear(); });

  function workboardQuery() {
    return client.getQueryCache().getAll().find((query) => (query.queryKey as readonly unknown[])[0] === 'shipments-cus');
  }

  it('fetches on mount with the workboard page size and cached list key', async () => {
    listCusShipmentWorkspace.mockResolvedValue(listResponse(7));
    render(probeUi(client));
    expect(await screen.findByText('7')).toBeTruthy();
    expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(1);
    expect(listCusShipmentWorkspace).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: CUS_PAGE_SIZE }));
    expect(workboardQuery()).toBeTruthy();
  });

  it('locks the refresh-cadence config that fixed the 27.8 staleness regression', async () => {
    // 30s polling + visibility refetch + no-blank must survive ANY refactor
    // of this hook. These per-query options override the app-wide defaults
    // (focus off, 5min staleTime) — deleting either replays the live-trial
    // bug where a driver's remote mutation never reached the parked board.
    listCusShipmentWorkspace.mockResolvedValue(listResponse(1));
    render(probeUi(client));
    await screen.findByText('1');
    const options = workboardQuery()!.options as unknown as Record<string, unknown>;
    expect(options.refetchInterval).toBe(30_000);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(options.refetchOnMount).toBe('always');
    expect(options.refetchOnWindowFocus).toBe('always');
    expect(options.placeholderData).toBeTruthy();
    expect(options.staleTime).toBe(Infinity);
  });

  it('polls every 30s of wall clock (behavioral, fake timers)', async () => {
    vi.useFakeTimers();
    try {
      listCusShipmentWorkspace.mockResolvedValue(listResponse(1));
      render(probeUi(client));
      // Flush the mount fetch under fake timers.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches on remount even with warm cached data (route-return parity)', async () => {
    listCusShipmentWorkspace.mockResolvedValue(listResponse(3));
    const view = render(probeUi(client));
    expect(await screen.findByText('3')).toBeTruthy();
    expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(1);

    // Route-away/route-back: same client, warm cache, staleTime Infinity —
    // the old hand-rolled hook still fetched on every mount.
    view.unmount();
    render(probeUi(client));
    await waitFor(() => expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(2));
  });

  it('keeps the previous page rendered while the next filter is in flight (no blank flash)', async () => {
    let releaseSecond: ((value: ShipmentCusWorkspaceListResponse) => void) | undefined;
    listCusShipmentWorkspace.mockResolvedValueOnce(listResponse(11));
    listCusShipmentWorkspace.mockImplementationOnce(() => new Promise((resolve) => { releaseSecond = resolve; }));
    const view = render(probeUi(client));
    expect(await screen.findByText('11')).toBeTruthy();

    nextParams = { ...baseParams, bucket: 'RUNNING' as never };
    view.rerender(probeUi(client));
    // While the second fetch is pending, the board still shows prior data.
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');
    releaseSecond?.(listResponse(22));
    expect(await screen.findByText('22')).toBeTruthy();
  });

  it('clears the error notice synchronously when loadList runs — the save-blocking message retires on refetch', async () => {
    let fail = true;
    listCusShipmentWorkspace.mockImplementation(() => {
      if (fail) return Promise.reject(new Error('Không thể tải danh sách lô hàng.'));
      return Promise.resolve(listResponse(5));
    });
    render(probeUi(client));
    await waitFor(() => expect(screen.getByText('Không thể tải danh sách lô hàng.')).toBeTruthy());

    fail = false;
    await act(async () => {
      screen.getByRole('button', { name: 'retry' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('none'));
    expect(await screen.findByText('5')).toBeTruthy();
  });
});
