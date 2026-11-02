import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/**
 * SIL-656 (id 763) — opening the TRỌNG LƯỢNG floating editor from its
 * "Nhập kg" trigger must land the caret in THAT row's input.
 *
 * Reported on staging build ed0056e1 (role CUS): after clicking "Nhập kg"
 * `document.activeElement` stayed on the BUTTON "Chỉnh sửa trọng lượng —
 * dòng 1", so the operator had to click the input a second time before they
 * could type. The LOẠI line already focused on open (SIL-552/608); the weight
 * line never did — the focus effect guarded on `openLine !== 'type'`.
 */
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

function weightTrigger(row = 0) {
  return screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })[row]!;
}

function weightInput(row = 0) {
  return screen.getByLabelText(`Trọng lượng (kg) — dòng ${row + 1}`) as HTMLInputElement;
}

function addContainer() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
}

describe('SIL-656 (id 763): "Nhập kg" autofocuses the weight input', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      containerTypes: [{ id: 20, code: '20DC', name: "20'DC" }],
    });
  });

  it('the empty weight line reads "Nhập kg" — the exact trigger QA clicked', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    expect(weightTrigger(0).textContent).toContain('Nhập kg');
  });

  it('clicking "Nhập kg" moves focus INTO the editor input (not left on the trigger)', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(weightTrigger(0));
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    const input = within(panel).getByLabelText('Trọng lượng (kg) — dòng 1') as HTMLInputElement;

    // The regression itself: before the fix activeElement stayed the BUTTON.
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(document.activeElement).not.toBe(weightTrigger(0));
    expect((document.activeElement as HTMLInputElement).tagName).toBe('INPUT');
  });

  it('focuses the input of the row that was clicked — never the first input in the table', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    expect(screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })).toHaveLength(2);

    // Row 2's trigger must focus ROW 2's input.
    fireEvent.click(weightTrigger(1));
    const panel2 = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 2' });
    const input2 = within(panel2).getByLabelText('Trọng lượng (kg) — dòng 2') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input2));
    expect(document.activeElement).not.toBe(weightInput(0));

    // Close it, then open row 1 and confirm the focus follows the row back.
    fireEvent.keyDown(input2, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(weightTrigger(1)));

    fireEvent.click(weightTrigger(0));
    const panel1 = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    const input1 = within(panel1).getByLabelText('Trọng lượng (kg) — dòng 1') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input1));
  });

  it('the operator can type a number immediately, with no second click', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(weightTrigger(0));
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    const input = within(panel).getByLabelText('Trọng lượng (kg) — dòng 1') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input).not.toBeDisabled();

    // Focus is already on the input, so the very next keystroke reaches it.
    fireEvent.change(input, { target: { value: '12000' } });
    expect(input.value).toBe('12000');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(panel).not.toHaveClass('is-open'));
    expect(weightTrigger(0).textContent).toContain('12.000');
  });

  it('Escape still returns focus to the trigger (close behaviour unchanged)', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(weightTrigger(0));
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    const input = within(panel).getByLabelText('Trọng lượng (kg) — dòng 1') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(panel).not.toHaveClass('is-open'));
    expect(document.activeElement).toBe(weightTrigger(0));
  });

  it('the LOẠI line keeps its own focus + menu hand-off (SIL-552/608 unchanged)', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getAllByRole('button', { name: /Chỉnh sửa loại container — dòng \d+/ })[0]!);
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa loại container — dòng 1' });
    const combo = within(panel).getByRole('combobox', { name: 'Loại container' });
    await waitFor(() => expect(document.activeElement).toBe(combo));
    await waitFor(() => expect(combo).toHaveAttribute('aria-expanded', 'true'));
  });
});
