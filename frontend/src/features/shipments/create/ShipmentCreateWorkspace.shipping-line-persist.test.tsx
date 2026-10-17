import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, createShippingLine } = vi.hoisted(() => ({ getBootstrap: vi.fn(), createShippingLine: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  createShippingLine,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** FB-114 verify-fail (ticket 171026185348) — "hãng tàu mới phải được lưu
 * vào danh mục chung trên server (không chỉ local form)". The dialog apply
 * persists through `createShippingLine` BEFORE the lot field is written and
 * the dialog closes; the dropdown mirrors the shared catalog; a failed
 * persist keeps the dialog open with the server's message (no fake success). */
describe('shipping line dialog persists to the shared catalog (FB-114 171026185348)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    createShippingLine.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [],
      shippingLines: [{ name: 'MSC' }],
    });
  });

  it('persists BEFORE closing, then applies the name to the lot and the dropdown', async () => {
    // Executor form on purpose: Promise.withResolvers is outside this
    // repo's ES2022 lib (same precedent as the other pending-promise tests).
    let resolveCreate!: (value: { id: number; name: string; created: boolean }) => void;
    createShippingLine.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));

    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' }));
    const dialog = await screen.findByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' });
    fireEvent.change(within(dialog).getByLabelText('Tên hãng tàu'), { target: { value: '  Ocean Network Express  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));

    // Order proof: the POST (trimmed) is already out while the dialog is
    // still open — the lot field and close wait for the server.
    expect(createShippingLine).toHaveBeenCalledWith('Ocean Network Express');
    expect(screen.getByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    expect((screen.getByRole('combobox', { name: /^Hãng tàu/ }) as HTMLInputElement).value).toBe('');

    await act(async () => {
      resolveCreate({ id: 55, name: 'Ocean Network Express', created: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Hãng tàu/ }) as HTMLInputElement).value).toBe('Ocean Network Express');

    // Catalog mirror: the dropdown now offers the persisted name next to the
    // catalog it came from.
    fireEvent.click(screen.getByRole('combobox', { name: /^Hãng tàu/ }));
    expect(await screen.findByRole('option', { name: 'Ocean Network Express' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'MSC' })).toBeTruthy();
  });

  it('echoes the server canonical name into the dropdown for a case-variant hit (created:false)', async () => {
    // Server idempotent path (e.g. the built-in default 'MSC' re-typed as
    // 'msc'): the lot field keeps the typed casing (free-text contract), the
    // catalog mirror merges the canonical name exactly once.
    createShippingLine.mockResolvedValue({ id: null, name: 'MSC', created: false });

    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' }));
    const dialog = await screen.findByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' });
    fireEvent.change(within(dialog).getByLabelText('Tên hãng tàu'), { target: { value: 'msc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Hãng tàu/ }) as HTMLInputElement).value).toBe('msc');

    fireEvent.click(screen.getByRole('combobox', { name: /^Hãng tàu/ }));
    const labels = (await screen.findAllByRole('option'))
      .map((option) => (option.textContent || '').trim())
      .filter((label) => label.toLowerCase() === 'msc');
    expect(labels).toEqual(['MSC']);
  });

  it('keeps the dialog open with the server message when the persist fails', async () => {
    createShippingLine.mockRejectedValue(new Error('Tên hãng tàu đã trùng nhà cung cấp trong danh mục. Vui lòng chọn tên khác.'));

    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' }));
    const dialog = await screen.findByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' });
    fireEvent.change(within(dialog).getByLabelText('Tên hãng tàu'), { target: { value: 'Ocean Network Express' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Tên hãng tàu đã trùng nhà cung cấp');
    expect(createShippingLine).toHaveBeenCalledTimes(1);
    // No fake success: the dialog stays open and the lot field is untouched.
    expect(screen.getByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: /^Hãng tàu/ }) as HTMLInputElement).value).toBe('');
  });
});
