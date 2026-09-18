import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
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

describe('shipment create cargo-mode toggle data scope', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('mode switch keeps identity fields and wipes only mode-scoped cargo data', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Identity inputs: direction + bill must SURVIVE the toggle (a8's browser
    // suspicion was that customer/direction/bill/route vanish — the state
    // machine spreads ...current over identity and never resets them).
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(bill, { target: { value: 'BL-SWEEP-001' } });
    expect(bill.value).toBe('BL-SWEEP-001');

    // Mode data: a complete container appointment so the toggle asks for
    // confirmation (the appointment is the only editor input mounted before
    // a cell gains focus in the spreadsheet grid).
    const timeInput = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]')!;
    fireEvent.change(timeInput, { target: { value: '09:00' } });
    const dateInput = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-date"]')!;
    fireEvent.change(dateInput, { target: { value: '20/09/2026' } });

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // The destructive move is gated: the confirm modal names the cargo scope.
    const confirm = await screen.findByRole('button', { name: 'Chuyển và xóa dữ liệu' });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(document.getElementById('shipment-trade-direction')?.textContent).toContain('Nhập khẩu');
      expect(document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input')?.value).toBe('BL-SWEEP-001');
    });
    // Container rows were reset (mode-scoped, per the modal copy).
    await waitFor(() => {
      const resetTime = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]');
      expect(resetTime?.value ?? '').toBe('');
    });
  });

  it('pristine toggle applies silently without the confirm modal', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // No mode data anywhere → no confirmation gate, and identity stays put.
    expect(screen.queryByRole('button', { name: 'Chuyển và xóa dữ liệu' })).toBeNull();
    await waitFor(() => {
      expect((document.getElementById('shipment-trade-direction') as HTMLSelectElement).value).toBe('');
    });
  });

  it('pristine back navigation does not ask for a discard confirmation', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Nothing has been typed: the Huỷ path (goBack) must navigate directly.
    // The isDirty memo treats `isAdHoc: false !== ''` as changed data, so a
    // pristine form currently reports dirty and blocks back with the modal.
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByText('Bỏ tạo lô hàng?')).toBeNull();
  });

  it.each(['time', 'date'])('guards a container %s draft that has not emitted a complete timestamp', async (part) => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    const input = document.querySelector<HTMLInputElement>(`input[id$="-customer-appointment-${part}"]`)!;
    const value = part === 'time' ? '14:' : '20/09';
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    expect(await screen.findByText('Chuyển loại hàng?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    await waitFor(() => expect(screen.queryByText('Chuyển loại hàng?')).not.toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /Hàng nguyên/ })).toBeChecked();
    expect(input).toHaveValue(value);
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển và xóa dữ liệu' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng lẻ/ })).toBeChecked());
  });

  it('guards an LCL weight-only draft and preserves it when the switch is cancelled', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    const weight = screen.getByLabelText('Trọng lượng (kg)');
    fireEvent.change(weight, { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng nguyên/ }));
    expect(await screen.findByText('Chuyển loại hàng?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    await waitFor(() => expect(screen.queryByText('Chuyển loại hàng?')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Trọng lượng (kg)')).toHaveValue(1200);
    expect(screen.getByRole('radio', { name: /Hàng lẻ/ })).toBeChecked();
  });

  it('guards an LCL warehouse-only selection before clearing it', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Kho lấy hàng' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Kho lấy hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Kho A' }));
    fireEvent.click(screen.getByRole('radio', { name: /Hàng nguyên/ }));
    expect(await screen.findByText('Chuyển loại hàng?')).toBeInTheDocument();
  });

  it('guards incomplete additional-delivery text even though the stored date is empty', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ngày giao' }));
    const date = document.querySelector<HTMLInputElement>('.csc-extra-dates__row [data-date-input]')!;
    fireEvent.change(date, { target: { value: '20/09' } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng nguyên/ }));
    expect(await screen.findByText('Chuyển loại hàng?')).toBeInTheDocument();
  });

  it('guards a partial LCL schedule but retains complete shared schedules without an unnecessary warning', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    fireEvent.change(screen.getByLabelText('Giờ — Hạn hoàn tất hải quan'), { target: { value: '14:' } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng nguyên/ }));
    expect(await screen.findByText('Chuyển loại hàng?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    await waitFor(() => expect(screen.queryByText('Chuyển loại hàng?')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Giờ — Hạn hoàn tất hải quan'), { target: { value: '14:23' } });
    fireEvent.change(screen.getByLabelText('Ngày — Hạn hoàn tất hải quan'), { target: { value: '20/09/2026' } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng nguyên/ }));
    expect(screen.queryByText('Chuyển loại hàng?')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Hàng nguyên/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    expect(screen.queryByText('Chuyển loại hàng?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Giờ — Hạn hoàn tất hải quan')).toHaveValue('14:23');
    expect(screen.getByLabelText('Ngày — Hạn hoàn tất hải quan')).toHaveValue('20/09/2026');
  });

  it('retains shipment notes across pristine and confirmed cargo-mode switches', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.change(screen.getByLabelText('Ghi chú cho khách hàng'), { target: { value: 'Call customer before delivery' } });
    fireEvent.change(screen.getByLabelText('Ghi chú cho lái xe'), { target: { value: 'Check seal before leaving' } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    expect(screen.queryByText('Chuyển loại hàng?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ghi chú cho khách hàng')).toHaveValue('Call customer before delivery');
    fireEvent.change(screen.getByLabelText('Quy cách đóng gói'), { target: { value: 'Pallet' } });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng nguyên/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển và xóa dữ liệu' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng nguyên/ })).toBeChecked());
    expect(screen.getByLabelText('Ghi chú cho khách hàng')).toHaveValue('Call customer before delivery');
    expect(screen.getByLabelText('Ghi chú cho lái xe')).toHaveValue('Check seal before leaving');
  });

  it.each(['time', 'date'])('guards deletion of a row containing only an incomplete %s and preserves it on cancel', async (part) => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const input = document.querySelector<HTMLInputElement>(`input[id$="-customer-appointment-${part}"]`)!;
    const value = part === 'time' ? '14:' : '20/09';
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 1' }));
    expect(await screen.findByText('Xóa container?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByText('Xóa container?')).not.toBeInTheDocument());
    expect(input).toHaveValue(value);
    expect(document.querySelectorAll('.csc-container-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await waitFor(() => expect(document.querySelectorAll('.csc-container-row')).toHaveLength(1));
  });

  it('deletes a pristine row directly without using another row’s pending time as its dirty state', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const time = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]')!;
    fireEvent.change(time, { target: { value: '14:' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 2' }));
    expect(screen.queryByText('Xóa container?')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.csc-container-row')).toHaveLength(1);
    expect(time).toHaveValue('14:');
  });
});

describe('Lệnh chạy ngoài toggle (20260916_3)', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('renders the toggle without the retired suffix and defaults OFF', async () => {
    renderWorkspace();
    const toggle = await screen.findByRole('checkbox', { name: 'Lệnh chạy ngoài' });
    expect(toggle).not.toBeChecked();
  });

  it('toggling never wipes typed content and switches the customer field to creatable mode', async () => {
    renderWorkspace();
    const customer = await screen.findByRole('combobox', { name: /^Khách hàng/ });
    fireEvent.change(customer, { target: { value: 'Khách vãng lai 8888' } });
    const toggle = screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' });
    fireEvent.click(toggle);
    expect(screen.getByRole('combobox', { name: /^Khách hàng/ })).toHaveValue('Khách vãng lai 8888');
    expect(screen.getByRole('combobox', { name: /^Khách hàng/ })).toHaveAttribute('placeholder', 'Chọn hoặc gõ tên mới');
    // Toggling back off preserves the content too.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    expect(screen.getByRole('combobox', { name: /^Khách hàng/ })).toHaveValue('Khách vãng lai 8888');
  });
});

describe('Lệnh chạy ngoài creatable fields — blur keeps committed text (QA 2026-09-18)', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  const blurKeepsText = async (label: RegExp, text: string): Promise<void> => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    const candidates = screen.getAllByRole('combobox', { name: label });
    const field = candidates.find((el) => !el.hasAttribute('disabled')) ?? candidates[0];
    await waitFor(() => expect(field).not.toBeDisabled());
    fireEvent.change(field, { target: { value: text } });
    fireEvent.blur(field);
    expect(screen.getAllByRole('combobox', { name: label }).find((el) => !el.hasAttribute('disabled'))).toHaveValue(text);
  };

  it('Khách hàng: free text survives blur in adhoc mode', async () => {
    await blurKeepsText(/^Khách hàng/, 'Khách vãng lai 8888');
  });
  it('Cảng nâng: free text survives blur in adhoc mode', async () => {
    await blurKeepsText(/^Cảng nâng/, 'Cảng ngoài 5');
  });

  // ── Row-tier persistence (card 20260918_8, TC-ROW-PERSIST) ─────────────
  // The container table's row cells are a distinct tier from the form-level
  // fields above: today the row factory stays disabled without a catalog
  // customer, and the row route has no creatable path. Row inputs are
  // targeted by id — the form-level factory is shipment-operational-site
  // and the form-level route is shipment-route, so only container-* cells
  // carry the container- prefix.
  const rowInput = (kind: 'factory' | 'route'): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(`tr.csc-container-row td[data-field-id$="-${kind}"] input`)!;

  it('row factory: free text survives blur with adhoc ON (TC-ROW-PERSIST-01)', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    const field = rowInput('factory');
    await waitFor(() => expect(field).not.toBeDisabled(), { timeout: 4000 });
    fireEvent.change(field, { target: { value: 'fadsf' } });
    fireEvent.blur(field);
    expect(field).toHaveValue('fadsf');
  });
  it('row route: free text survives blur with adhoc ON (TC-ROW-PERSIST-02)', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    const field = rowInput('route');
    await waitFor(() => expect(field).not.toBeDisabled(), { timeout: 4000 });
    fireEvent.change(field, { target: { value: 'Tuyến riêng dòng 1' } });
    fireEvent.blur(field);
    expect(field).toHaveValue('Tuyến riêng dòng 1');
  });
});

describe('Loại container row commit (20260918_11)', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      containerTypes: [{ id: 20, code: '20DC', name: "20'DC" }],
    });
  });

  it('picking a container type commits the id through the workspace wiring', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    const combo = await screen.findByRole('combobox', { name: 'Loại container' });
    fireEvent.click(combo);
    const opt = await screen.findByRole('option', { name: '20DC' });
    fireEvent.click(opt);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Loại container' })).toHaveValue('20DC'));
    // The cell display is read from the row's catalog id — it proves the
    // row state holds the id, not just the input's transient text.
    expect(document.querySelector('[data-field-id$="-type"]')?.textContent).toContain('20DC');
    fireEvent.blur(screen.getByRole('combobox', { name: 'Loại container' }));
    // Blur must not feed the option label back as the id (which blanked the
    // cell and failed the save with "containerTypeId là bắt buộc").
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Loại container' })).toHaveValue('20DC'));
    expect(document.querySelector('[data-field-id$="-type"]')?.textContent).toContain('20DC');
    expect(document.querySelector('[data-field-id$="-type"]')?.textContent).not.toContain('Chọn loại');
  });
});

describe('Factory dropdown NaN race (20260918_16)', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 41, siteType: 'FACTORY', name: 'Nhà máy Long Minh', shortName: 'NM Long Minh' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('a customer pick fires the sites fetch once with the numeric id and blur cannot corrupt it', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(listOperationalSites).toHaveBeenCalledWith(1));
    fireEvent.blur(screen.getByRole('combobox', { name: 'Khách hàng' }));
    // Before the blur fix, the label "KH A" rode into customerId and the
    // effect requested customerId=NaN — the late 400 emptied the factory
    // dropdown after the good response had landed.
    await waitFor(() => expect(listOperationalSites).toHaveBeenCalledTimes(1));
    expect(listOperationalSites.mock.calls.every(([id]) => Number.isFinite(id as number))).toBe(true);
    // The catalog factory pick stays reachable end-to-end.
    const factory = document.querySelector<HTMLInputElement>('tr.csc-container-row td[data-field-id$="-factory"] input')!;
    await waitFor(() => expect(factory).not.toBeDisabled());
    fireEvent.click(factory);
    fireEvent.click(await screen.findByRole('option', { name: 'NM Long Minh' }));
    await waitFor(() => expect(factory).toHaveValue('NM Long Minh'));
    fireEvent.blur(factory);
    await waitFor(() => expect(factory).toHaveValue('NM Long Minh'));
    expect(document.querySelector('[data-field-id$="-factory"]')?.textContent).toContain('NM Long Minh');
  });
});
