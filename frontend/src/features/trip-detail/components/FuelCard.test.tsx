import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type { TripDerivedData } from '../types';

/**
 * Card 20261006_391 — the fuel-voucher actions failed silently: the xlsx
 * export swallowed download errors (bare `catch {}`) and neither action
 * reported busy or success. Both follow the FinancePage export contract
 * (QA PASSED 06/10): busy label on the button, success toast, error toast.
 */

const api = vi.hoisted(() => ({ getBlob: vi.fn(), getForText: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api', () => ({ api }));
vi.mock('../../../components/shared/Toast', () => ({ useToast: () => ({ toast }) }));

import { FuelCard } from './FuelCard';

interface WinStub {
  document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
}

const trip = {
  id: 42,
  tripCode: 'TRP-202610-0042',
  fuelMode: 'PUMP',
  fuelActualUnitPrice: null,
  fuelPriceApplied: 23000,
  fuelSupplier: { name: 'Petrolimex Cầu Diễn' },
} as unknown as TripDetail;

const derived = {
  fuelLiters: 120,
  computedLiters: 130,
  ttbq: 8.5,
  fuelVarianceLiters: -10,
  fuelVarianceOver: false,
} as unknown as TripDerivedData;

const openMock = vi.fn((): WinStub => ({
  document: { write: vi.fn(), close: vi.fn() },
  close: vi.fn(),
}));

function lastWindow(): WinStub {
  const entry = openMock.mock.results.at(-1);
  if (!entry) throw new Error('window.open was not called');
  return entry.value;
}

function renderCard() {
  return render(<FuelCard trip={trip} derived={derived} fuelPriceConfig={22000} />);
}

beforeEach(() => {
  api.getBlob.mockReset();
  api.getForText.mockReset();
  toast.mockReset();
  openMock.mockClear();
  vi.stubGlobal('open', openMock);
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

describe('FuelCard fuel voucher feedback (card 20261006_391)', () => {
  it('shows a busy label while building the xlsx and toasts success when the download starts', async () => {
    renderCard();
    const btn = screen.getByRole('button', { name: 'Xuất Excel' });
    let resolveBlob: (b: Blob) => void = () => {};
    api.getBlob.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => { resolveBlob = resolve; }),
    );

    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeTruthy();

    resolveBlob(new Blob(['phieu']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith({ kind: 'success', message: 'Đã xuất phiếu cấp nhiên liệu ra tệp Excel.' });
  });

  it('toasts an error when the xlsx download fails instead of swallowing it', async () => {
    renderCard();
    api.getBlob.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ kind: 'error', message: 'Chưa xuất được tệp Excel — vui lòng thử lại.' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
  });

  it('shows a busy label while fetching the voucher, writes it into the popup, and toasts success', async () => {
    renderCard();
    let resolveHtml: (h: string) => void = () => {};
    api.getForText.mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveHtml = resolve; }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'In phiếu cấp dầu' }));
    expect(screen.getByRole('button', { name: 'Đang mở…' })).toBeTruthy();

    resolveHtml('<html>phieu</html>');
    await waitFor(() => expect(screen.getByRole('button', { name: 'In phiếu cấp dầu' })).toBeTruthy());
    expect(lastWindow().document.write).toHaveBeenCalledWith('<html>phieu</html>');
    expect(toast).toHaveBeenCalledWith({ kind: 'success', message: 'Đã mở phiếu cấp dầu để in.' });
  });

  it('closes the popup and toasts an error when the voucher fetch fails', async () => {
    renderCard();
    api.getForText.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'In phiếu cấp dầu' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ kind: 'error', message: 'Không mở được phiếu cấp dầu — vui lòng thử lại.' }));
    expect(lastWindow().close).toHaveBeenCalled();
  });
});
