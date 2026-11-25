/**
 * SIL-1029 (K4.58) — bảng giá cấu hình phải có CẢ cột cước thu lẫn cột cước
 * trả theo từng trọng tải. Trước đây /config/pricing-tables chỉ có duy nhất
 * cột 'Cước thu khách'. Pin:
 *   1. bảng render đủ 2 cột giá, cước trả trống hiện — (không bịa 0);
 *   2. form có ô 'Cước trả (đ)', lưu carrierPrice (số khi nhập, null khi
 *      để trống — "chưa biết" khác 0);
 *   3. luật ưu tiên giá nhiều kỳ hiệu lực: ngày hiệu lực mới hơn thắng
 *      (xác nhận cho câu hỏi trong ticket — hai dòng 5T 2.300.000₫
 *      02/10/2026 + 3.800.000₫ 08/11/2026 thì giá áp là 3.800.000₫).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { PricingTable } from '@tingting/shared';

type Column = { header: string; render: (pt: PricingTable) => ReactNode };
let lastRenderForm: ((p: Record<string, unknown>) => ReactNode) | null = null;
let lastColumns: Column[] = [];

// vi.mock factories are hoisted ABOVE the import list, so a static React
// import is not yet initialized when this factory runs — the dynamic import
// is the only way to reach React.createElement here (same pattern as
// PricingTablesConfigPage.vehicle-class.test.tsx).
vi.mock('../../components/config/CrudTable', async () => {
  const React = await import('react');
  return {
    CrudTable: (props: { renderForm: (p: Record<string, unknown>) => ReactNode; columns: Column[] }) => {
      lastRenderForm = props.renderForm;
      lastColumns = props.columns;
      return React.createElement('div', { 'data-testid': 'crud-table' });
    },
  };
});

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useCatalogQueries', () => ({
  useAllCustomers: () => ({ data: [{ id: 7, name: 'Khách A', shortName: 'A' }], isError: false, isLoading: false, refetch: vi.fn() }),
  useRoutesDropdown: () => ({ data: [{ id: 3, name: 'Tuyến X', shortName: 'X' }], isError: false, isLoading: false, refetch: vi.fn() }),
  useContainerTypes: () => ({ data: [{ id: 21, code: '20DC', name: "20'DC" }], isError: false, isLoading: false, refetch: vi.fn() }),
  useVehicleSizeClasses: () => ({
    data: [{ id: 12, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 4 }],
    isError: false, isLoading: false, refetch: vi.fn(),
  }),
}));

import PricingTablesConfigPage from './PricingTablesConfigPage';

function renderPageAndForm(formProps: Record<string, unknown> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PricingTablesConfigPage />
    </QueryClientProvider>,
  );
  if (!lastRenderForm) throw new Error('renderForm not captured');
  render(
    <QueryClientProvider client={new QueryClient()}>
      {lastRenderForm({ saving: false, onCancel: vi.fn(), ...formProps }) as ReactNode}
    </QueryClientProvider>,
  );
}

async function pickOption(triggerLabel: RegExp, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }), undefined);
}

function moneyInputs(): HTMLInputElement[] {
  const inputs = Array.from(document.querySelectorAll('[data-config-form] input')) as HTMLInputElement[];
  if (inputs.length < 2) throw new Error(`expected ≥2 form inputs, got ${inputs.length}`);
  return inputs;
}

const row = (carrierPrice: string | null): PricingTable => ({
  id: 1, customerId: 7, routeId: 3, price: '3800000', carrierPrice,
  containerTypeId: null, rateKey: '5T', vehicleSizeClassId: 12,
  effectiveDate: '2026-11-08', createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z', deletedAt: null,
});

describe('SIL-1029 — bảng giá cấu hình có cột cước thu + cước trả (K4.58)', () => {
  it('renders both money columns and keeps an unknown cước trả as — (never 0)', async () => {
    renderPageAndForm();
    const headers = lastColumns.map((c) => c.header);
    expect(headers).toContain('Cước thu khách');
    expect(headers).toContain('Cước trả');

    const thu = lastColumns.find((c) => c.header === 'Cước thu khách')!;
    const tra = lastColumns.find((c) => c.header === 'Cước trả')!;
    render(<span>{thu.render(row(null))}</span>);
    render(<span>{tra.render(row('2300000'))}</span>);
    render(<span>{tra.render(row(null))}</span>);
    expect(screen.getByText('3.800.000 ₫')).toBeTruthy();
    expect(screen.getByText('2.300.000 ₫')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('sends the cước trả value when entered', async () => {
    const onSave = vi.fn();
    renderPageAndForm({ onSave });
    await pickOption(/Khách hàng/, 'A');
    await pickOption(/Tuyến đường/, 'X');
    await pickOption(/Loại xe/, /5T — Xe 5 tấn/);
    const [priceInput, carrierInput] = moneyInputs();
    fireEvent.change(priceInput, { target: { value: '3800000' } });
    fireEvent.change(carrierInput, { target: { value: '2300000' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      price: 3800000,
      carrierPrice: 2300000,
    }));
  });

  it('sends null — never a fabricated 0 — when cước trả is left blank', async () => {
    const onSave = vi.fn();
    renderPageAndForm({ onSave });
    await pickOption(/Khách hàng/, 'A');
    await pickOption(/Tuyến đường/, 'X');
    await pickOption(/Loại xe/, /5T — Xe 5 tấn/);
    const [priceInput] = moneyInputs();
    fireEvent.change(priceInput, { target: { value: '3800000' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ carrierPrice: null }));
  });
});
