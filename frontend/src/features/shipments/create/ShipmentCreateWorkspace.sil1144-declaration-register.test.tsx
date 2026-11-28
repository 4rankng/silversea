// SIL-1144 (QA-Retest4; KB Chương 3 §3.4) — the create/edit workspace
// carries the "Tờ khai hải quan" register: per-carrier rows with the
// §3.4.2 completeness voice (có tờ khai = ĐẦY ĐỦ; không có = VẪN THIẾU),
// a per-row LOCAL delete (§3.4.1 "thao tác xóa là cục bộ từng dòng" — the
// K2.13 typing fan-out never fires on a delete), and on FCL the
// "Thêm tờ khai" slot row (the container table's own row-add convention).
// The editable inputs stay where §3.4.1 pins them (table column / the LCL
// ô beside Số Bill/Booking) — the register reads those same values.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

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

function registerRow(index: number): HTMLElement {
  const row = document.querySelector(`[data-field-id="declaration-row-${index}"]`);
  expect(row, `register row ${index} renders`).toBeTruthy();
  return row as HTMLElement;
}

function rowPill(row: HTMLElement): string {
  return row.querySelector('.csc-decl-pill')?.textContent ?? '';
}

function rowValue(row: HTMLElement): string {
  return row.querySelector('.csc-decl-row__value')?.textContent ?? '';
}

function tableDeclarationInput(index: number): HTMLInputElement {
  // The table cell input names itself via aria-label (UTextField hideLabel
  // law); rows arrive in DOM order, which is the sheet's STT order.
  const inputs = [...document.querySelectorAll<HTMLInputElement>('.csc-container-table [aria-label="Số tờ khai"]')];
  expect(inputs.length, 'one declaration input per container row').toBeGreaterThanOrEqual(index + 1);
  return inputs[index]!;
}

describe('SIL-1144 — Tờ khai hải quan register on the create form', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('FCL: one register row per container, Vẫn thiếu by default, Đầy đủ once the table cell holds a number', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const section = await waitFor(() => {
      const el = document.querySelector('#shipment-section-declaration');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(section.querySelector('h2')?.textContent).toContain('Tờ khai hải quan');

    // The single empty row: Vẫn thiếu / Chưa có tờ khai; the delete has
    // nothing to clear and sits disabled.
    const first = registerRow(1);
    expect(rowPill(first)).toBe('Vẫn thiếu');
    expect(rowValue(first)).toBe('Chưa có tờ khai');
    expect((first.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    // Typing in the TABLE's declaration column (the §3.4.1 input) flips the
    // register row to Đầy đủ with the number.
    fireEvent.change(tableDeclarationInput(0), { target: { value: 'TK-001' } });
    await waitFor(() => expect(rowPill(registerRow(1))).toBe('Đầy đủ'));
    expect(rowValue(registerRow(1))).toBe('TK-001');
    expect((registerRow(1).querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('FCL: per-row delete is LOCAL — a sibling sharing the number keeps it; Thêm tờ khai appends a slot', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Two containers; row 1's number rides both per the shared-number model
    // (the second row was typed its own here to prove locality either way).
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    fireEvent.change(tableDeclarationInput(0), { target: { value: 'TK-001' } });
    fireEvent.change(tableDeclarationInput(1), { target: { value: 'TK-001' } });
    await waitFor(() => expect(rowPill(registerRow(2))).toBe('Đầy đủ'));

    // The add-declaration button appends ONE declaration slot (a container
    // row through the table's row-add convention).
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm tờ khai' }));
    await waitFor(() => {
      expect(document.querySelectorAll('.csc-container-table tbody tr')).toHaveLength(3);
      expect(document.querySelectorAll('[data-field-id^="declaration-row-"]')).toHaveLength(3);
    });

    // Deleting row 1's declaration clears ONLY row 1 — row 2 keeps TK-001
    // (the §3.4.1 locality law; no K2.13 fan-out on delete).
    fireEvent.click((registerRow(1).querySelector('button') as HTMLButtonElement));
    await waitFor(() => expect(rowValue(registerRow(1))).toBe('Chưa có tờ khai'));
    expect(rowPill(registerRow(1))).toBe('Vẫn thiếu');
    expect(rowValue(registerRow(2))).toBe('TK-001');
    expect(rowPill(registerRow(2))).toBe('Đầy đủ');
  });

  it('LCL: the register mirrors the lot-level ô beside Số Bill/Booking; its delete clears that ô', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    const section = await waitFor(() => {
      const el = document.querySelector('#shipment-section-declaration');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(section.querySelector('h2')?.textContent).toContain('Tờ khai hải quan');

    const row = section.querySelector('[data-field-id="declaration-row-lcl"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(rowPill(row)).toBe('Vẫn thiếu');
    expect(rowValue(row)).toBe('Chưa có tờ khai');

    // The lot-level ô (§3.4.1: beside Số Bill/Booking) drives the register.
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: '  TK-LCL-1144  ' } });
    await waitFor(() => expect(rowPill(row)).toBe('Đầy đủ'));
    expect(rowValue(row)).toBe('TK-LCL-1144');

    // The register delete clears the ô itself.
    fireEvent.click(row.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect((screen.getByLabelText('Số tờ khai') as HTMLInputElement).value).toBe(''));
    expect(rowPill(row)).toBe('Vẫn thiếu');
    // LCL is single-declaration by law — no add button.
    expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
  });
});
