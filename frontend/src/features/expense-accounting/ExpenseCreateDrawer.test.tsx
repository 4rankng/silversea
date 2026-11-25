import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingCreate } from '@tingting/shared';
const createBatch = vi.hoisted(() => vi.fn());
const confirmEntries = vi.hoisted(() => vi.fn());
const tienDuong = vi.hoisted(() => vi.fn());
const chiHo = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { createBatch, confirm: confirmEntries } }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuTienDuong: tienDuong, getPhoiPhieuChiHo: chiHo }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseCreateDrawer } from './ExpenseCreateDrawer';
const work = { tripId: 10, shipmentId: 42, shipmentCode: 'BL7', containerNumber: 'CONT7' };
const lotWork = { ...work, tripId: null };
const catalog = { staff: [{ id: 16, name: 'Driver' }], accounts: [], accountants: [], opsUsers: [{ id: 15, name: 'Assigned OPS' }], advances: [], suppliers: [{ id: 3, name: 'Nhà xe A' }], carriers: [], expenseTypes: [] };
const renderDrawer = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
/** typed view over the mocked request body — the mock's arguments are `any`. */
function sentItems(call: number): ExpenseAccountingCreate[] {
  const request = createBatch.mock.calls[call][0] as { items: ExpenseAccountingCreate[] };
  return request.items;
}
// "Loại chi phí lái xe" có ≥5 lựa chọn nên UuiSelectField mở ở dạng combobox
// tìm kiếm; các select ngắn (nhóm chi phí, bên thực chi…) là nút mở listbox.
async function fillRow(row: number, amount: string, charge = '0') {
  fireEvent.click(screen.getAllByRole('combobox', { name: /Loại chi phí lái xe/ })[row]);
  // Bỏ qua mục "Chọn loại chi phí" — lấy lựa chọn đầu tiên thật sự.
  fireEvent.click((await screen.findAllByRole('option', { name: /^(?!Chọn)/ }))[0]);
  fireEvent.change(screen.getAllByLabelText(/Thực chi/)[row], { target: { value: amount } });
  fireEvent.change(screen.getAllByLabelText(/Thực thu/)[row], { target: { value: charge } });
}
beforeEach(() => {
  createBatch.mockReset().mockResolvedValue({ items: [] });
  confirmEntries.mockReset().mockResolvedValue([]);
  // Card 191026160000 — each group panel's sub-table lists the trip's existing
  // entries of that group; default fixtures answer empty, the sub-table test
  // overrides.
  tienDuong.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, rows: [], totals: { total: 0, confirmed: 0 } });
  chiHo.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, shipmentId: 42, ngayLayPhoi: null, trangThaiLay: null, rows: [], totals: { thu: 0, tra: 0 } });
});
it('khai chi phí ở mức lô: nút Lưu bật khi không có chuyến, payload mang shipmentId và tripId null, Bên thực chi mặc định là Công ty trả trực tiếp', async () => {
  const onClose = vi.fn(); const onSaved = vi.fn();
  renderDrawer(<ExpenseCreateDrawer work={lotWork} catalog={catalog} onClose={onClose} onSaved={onSaved} />);
  // PM ruling: kế toán khai chi phí thì "Bên thực chi" mặc định là công ty trả trực tiếp.
  expect(screen.getByRole('button', { name: /Bên thực chi/ })).toHaveTextContent('Công ty trả trực tiếp');
  const save = screen.getByRole('button', { name: /Lưu 1 khoản chi/ });
  expect(save).toBeEnabled();
  await fillRow(0, '120000', '120000');
  fireEvent.click(save);
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(createBatch.mock.calls[0][1]).toBeTruthy();
  expect(sentItems(0)).toHaveLength(1);
  expect(sentItems(0)[0]).toMatchObject({ tripId: null, shipmentId: 42, payerKind: 'COMPANY', amount: 120000, customerChargeAmount: 120000 });
  expect(onSaved).toHaveBeenCalledTimes(1);
  // TC-COSTUX-04 — drawer giữ mở để nhập tiếp; "Đóng" mới kết thúc phiên.
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Đã lưu khoản chi.');
});
it('lưu nhiều dòng một lần: hai dòng đi cùng một request, dòng sai thì không gọi API và nêu đúng số dòng', { timeout: 15000 }, async () => {
  renderDrawer(<ExpenseCreateDrawer work={lotWork} catalog={catalog} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng nhóm Chi phí lô hàng' }));
  expect(screen.getByRole('button', { name: /Lưu 2 khoản chi/ })).toBeEnabled();
  await fillRow(0, '1000');
  await fillRow(1, '0');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 2 khoản chi/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Dòng 2:');
  expect(createBatch).not.toHaveBeenCalled();
  fireEvent.change(screen.getAllByLabelText(/Thực chi/)[1], { target: { value: '5000' } });
  fireEvent.click(screen.getByRole('button', { name: /Lưu 2 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)).toHaveLength(2);
});
// SIL-949 (KB §10.6.4, K10.32) — ô "chứng từ" là cờ "Có hóa đơn" (FAIL 03:59
// 25/11: cặp số/ngày hiển thị sẵn, tùy chọn — đúng lỗi cần sửa). Tắt cờ: cặp
// ẩn hoàn toàn, dòng không mang số hóa đơn. Bật cờ: cặp hiện ra và Số hóa đơn
// bắt buộc; tắt cờ thì xóa sạch số/ngày đã gõ.
it('ô chứng từ "Có hóa đơn" là cờ: tắt ẩn cặp số/ngày, bật hiện và bắt buộc số hóa đơn (KB §10.6.4, SIL-949)', async () => {
  renderDrawer(<ExpenseCreateDrawer work={lotWork} catalog={catalog} onClose={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Loại chứng từ/ })).not.toBeInTheDocument();
  const flag = screen.getByLabelText('Có hóa đơn');
  expect(flag).not.toBeChecked();
  // Flag OFF — the pair renders nowhere (the pre-fix "Để trống nếu không có
  // hóa đơn" optional pair is gone with it).
  expect(screen.queryByLabelText(/Số hóa đơn/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Ngày hóa đơn/)).not.toBeInTheDocument();
  expect(screen.queryByText('Để trống nếu không có hóa đơn')).not.toBeInTheDocument();
  // Flag ON — the pair appears; toggling OFF again wipes the typed values.
  fireEvent.click(flag);
  fireEvent.change(screen.getByLabelText(/Số hóa đơn/), { target: { value: 'HD-2026-09' } });
  fireEvent.click(screen.getByLabelText('Có hóa đơn'));
  expect(screen.queryByLabelText(/Số hóa đơn/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Có hóa đơn'));
  expect(screen.getByLabelText(/Số hóa đơn/)).toHaveValue('');
  // Flag ON with an empty Số hóa đơn — save is dead at the drawer edge with
  // the named message; nothing reaches the API.
  await fillRow(0, '9000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Dòng 1: Bật "Có hóa đơn" thì bắt buộc nhập số hóa đơn.');
  expect(createBatch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Số hóa đơn/), { target: { value: 'HD-2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)[0]).toMatchObject({ invoiceNumber: 'HD-2026-09' });
  // Next row stays flag-OFF → ships no invoice at all.
  await fillRow(0, '1000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
  expect(sentItems(1)[0]).toMatchObject({ invoiceNumber: null, invoiceDate: null });
});
// FAIL 03:59 25/11 — the checkbox was missing on BOTH groups (Tiền đường and
// Chi phí lô hàng). SIL-1028 replaces the tab pair with two side-by-side group
// panels; the flag rides every draft row of BOTH panels and the pair stays
// hidden until it is on.
it('ô "Có hóa đơn" hiện ở dòng nhập của cả hai nhóm Tiền đường và Chi phí lô hàng (FAIL 25/11, SIL-1028)', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng nhóm Tiền đường' }));
  expect(screen.getAllByLabelText('Có hóa đơn')).toHaveLength(2);
  expect(screen.queryByLabelText(/Số hóa đơn/)).not.toBeInTheDocument();
});
// SIL-1028 (KB K6.9) — KHÔNG còn cặp tab: hai nhóm "Tiền đường" / "Chi phí lô
// hàng" hiển thị cạnh nhau dưới dạng hai khu song song (QA 25/11 chốt tab
// không phải "hiển thị cạnh nhau"). Không nhóm nào khác được chào bán.
it('hai nhóm Tiền đường và Chi phí lô hàng hiển thị cạnh nhau, không tab và không nhóm khác (SIL-1028, KB K6.9)', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: /^Nhóm chi phí: / }).map(panel => panel.getAttribute('aria-label')))
    .toEqual(['Nhóm chi phí: Tiền đường', 'Nhóm chi phí: Chi phí lô hàng']);
  expect(screen.queryByRole('option', { name: 'Giao nhận Ops' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Phát sinh Ops' })).not.toBeInTheDocument();
});

// SIL-1028 (KB K6.9) — QA staging 25/11 (build 4b923af1): "Ở chế độ xem đầu
// tiên, ô 'Người chi' và 'Nhà cung cấp' đều không có (0 lần xuất hiện)". Ngay
// ở chế độ xem đầu form phải có đủ 3 ô: Người chi, Nhà cung cấp, Bên thực chi.
it('SIL-1028: form mở đầu có đủ ô Người chi / Nhà cung cấp / Bên thực chi', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Bên thực chi/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Người chi/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Nhà cung cấp/ })).toBeInTheDocument();
});

it('bảng con theo nhóm: mỗi khu liệt kê khoản của NHÓM ĐÓ, tích từng dòng rồi Lưu duyệt hàng loạt', async () => {
  chiHo.mockResolvedValue({
    tripId: 10, tripCode: null, shipmentId: 42, ngayLayPhoi: null, trangThaiLay: null,
    totals: { thu: 0, tra: 0 },
    rows: [
      { entryId: 71, sourceId: 7, version: 2, sourceKind: 'OPS', feeName: 'Cân xe', shipmentCode: 'BL7', invoiceNumber: 'HD-1', amountTra: 500000, amountThu: 0, payerName: null, payerUserId: null, confirmed: false },
      { entryId: 72, sourceId: 8, version: 1, sourceKind: 'OPS', feeName: 'Soi chiếu', shipmentCode: 'BL7', invoiceNumber: null, amountTra: 300000, amountThu: null, payerName: null, payerUserId: null, confirmed: true },
      { entryId: 73, sourceId: 9, version: 1, sourceKind: 'TRIP', feeName: 'Chi phí chuyến', shipmentCode: 'BL7', invoiceNumber: null, amountTra: 1000, amountThu: null, payerName: null, payerUserId: null, confirmed: false },
    ],
  });
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} onSaved={vi.fn()} />);
  // SIL-1028 — mỗi khu tự mang bảng con của NHÓM MÌNH: khu "Chi phí lô hàng"
  // liệt kê các khoản LOẠI ĐÓ dưới form; dòng TRIP không phải dòng chi hộ tích
  // được. Khu "Tiền đường" không nhận dòng nào của loại này.
  expect(await screen.findByText('Cân xe')).toBeInTheDocument();
  expect(screen.queryByText('Chi phí chuyến')).not.toBeInTheDocument();
  const lotPanel = screen.getByRole('region', { name: 'Nhóm chi phí: Chi phí lô hàng' });
  const roadPanel = screen.getByRole('region', { name: 'Nhóm chi phí: Tiền đường' });
  expect(within(lotPanel).getByText('Cân xe')).toBeInTheDocument();
  expect(within(roadPanel).queryByText('Cân xe')).not.toBeInTheDocument();
  const tick = screen.getByRole('checkbox', { name: 'Chọn dòng 1' });
  expect(tick).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Chọn dòng 2' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả dòng chưa duyệt' }));
  fireEvent.click(screen.getByRole('button', { name: /Lưu duyệt \(1\)/ }));
  await waitFor(() => expect(confirmEntries).toHaveBeenCalledTimes(1));
  expect(confirmEntries.mock.calls[0][0]).toEqual([{ sourceKind: 'OPS', sourceId: 71, expectedVersion: 2 }]);
});

it('khu Tiền đường liệt kê khoản lái xe nhập và duyệt theo DRIVER (SIL-1028)', async () => {
  tienDuong.mockResolvedValue({
    tripId: 10, tripCode: null, totals: { total: 80000, confirmed: 0 },
    rows: [
      { sourceId: 61, version: 4, costType: 'TOLL', feeName: null, driverEnteredAmount: 80000, amount: 80000, confirmed: false, driverName: 'Tài xế A', payerName: null, occurredAt: '2026-10-19' },
    ],
  });
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} initialGroup="DRIVER_ROAD" onClose={vi.fn()} />);
  expect(await screen.findByText('Phí cầu đường')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả dòng chưa duyệt' }));
  fireEvent.click(screen.getByRole('button', { name: /Lưu duyệt \(1\)/ }));
  await waitFor(() => expect(confirmEntries).toHaveBeenCalledTimes(1));
  expect(confirmEntries.mock.calls[0][0]).toEqual([{ sourceKind: 'DRIVER', sourceId: 61, expectedVersion: 4 }]);
});
it('tiền đường giữ nguyên luật thu = 0 và gửi đúng phân loại; key được giữ khi lưu lỗi rồi thử lại', async () => {
  createBatch.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce({ items: [] });
  const onClose = vi.fn();
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} initialGroup="DRIVER_ROAD" onClose={onClose} />);
  fireEvent.click(screen.getByRole('combobox', { name: /Loại chi phí lái xe/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Vé cầu đường' }));
  fireEvent.change(screen.getAllByLabelText(/Thực chi/)[0], { target: { value: '80000' } });
  fireEvent.change(screen.getByLabelText(/Tên khoản chi/), { target: { value: 'Vé qua trạm' } });
  expect(screen.getByLabelText(/Thực thu/)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await screen.findByText('Mất phản hồi');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
  expect(sentItems(0)[0]).toMatchObject({ tripId: 10, shipmentId: 42, costGroup: 'DRIVER_ROAD', driverCostType: 'TOLL', expenseTypeCode: 'TOLL', feeName: 'Vé qua trạm', amount: 80000, customerChargeAmount: 0, payerKind: 'COMPANY' });
  expect(createBatch.mock.calls[1][1]).toBe(createBatch.mock.calls[0][1]);
});
it('OPS context chỉ chọn người chi là Ops; lưu được khi đã chọn người chi', async () => {
  const onClose = vi.fn(); const onSaved = vi.fn();
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} entryScope="OPS" onClose={onClose} onSaved={onSaved} />);
  await fillRow(0, '1000', '7000');
  // PM ruling: mặc định vẫn là công ty trả trực tiếp; chủ động đổi sang người chi.
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhân viên chi' }));
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  expect(createBatch).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent('Chọn người chi hoặc nhà cung cấp.');
  fireEvent.click(screen.getByRole('button', { name: /Người chi/ }));
  expect(screen.queryByRole('option', { name: 'Driver' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('option', { name: 'Assigned OPS' }));
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)[0]).toMatchObject({ tripId: 10, costGroup: 'DRIVER_SHIPMENT', amount: 1000, customerChargeAmount: 7000, payerKind: 'USER', payerUserId: 15 });
  expect(onSaved).toHaveBeenCalledTimes(1);
  // FB-097 — drawer giữ mở để nhập tiếp.
  expect(onClose).not.toHaveBeenCalled();
});
it('labels the equal-amount checkbox with the unified chi-hộ wording (card 20260924_1, image10)', () => {
  // One concept, one term app-wide (law §8): the chi-hộ dialog says
  // "Nhập Thu và Trả bằng nhau"; this panel's "Thu bằng trả" variant is gone.
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Nhập Thu và Trả bằng nhau')).toBeInTheDocument();
  expect(screen.queryByLabelText('Thu bằng trả')).not.toBeInTheDocument();
});

// KB Ch.10 §10.7.2 (SIL-950) — thứ tự trường trong một dòng khai chi: Ngày ·
// Nhóm chi phí (nay là tiêu đề khu song song đứng TRƯỚC dòng, SIL-1028) · Tên
// khoản chi · Bên thực chi (Người chi / Nhà cung cấp hiện đúng slot theo lựa
// chọn) · ô chứng từ "Có hóa đơn" + Số hóa đơn – ngày hóa đơn (SIL-949: cờ
// bật mới hiện) · 3 trường ngoài danh sách KB (Loại chi phí lái xe, Thực chi,
// Thực thu) xếp sau nhóm trường KB · ô đánh dấu CUỐI.
it('KB §10.7.2 — thứ tự trường dòng khai chi, Ngày chi đứng đầu và ô đánh dấu đứng cuối (SIL-950)', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  // SIL-949 — the pair hides behind the ô-chứng-từ flag; turn it on so the
  // full KB order is measurable.
  fireEvent.click(screen.getByLabelText('Có hóa đơn'));
  const row = screen.getByText('Khoản 1').closest('section');
  expect(row).not.toBeNull();
  const text = row!.textContent ?? '';
  // Tra TUẦN TỰ từ mốc trước: trigger select của nhà in sẵn nhãn lựa chọn
  // trong DOM ("…Nhân viên chiNhà cung cấp…"), nên chuỗi trùng tên ô chỉ tìm
  // được đúng ô của nó khi tìm TIẾP TỪ vị trí trước — còn thứ tự field là
  // thứ tự DOM của các ô.
  let at = -1;
  for (const label of ['Ngày chi', 'Tên khoản chi', 'Bên thực chi', 'Người chi', 'Nhà cung cấp', 'Có hóa đơn', 'Số hóa đơn', 'Ngày hóa đơn',
    'Loại chi phí lái xe', 'Thực chi (VND)', 'Thực thu — thu khách (VND)', 'Nhập Thu và Trả bằng nhau']) {
    const found = text.indexOf(label, at + 1);
    expect(found).toBeGreaterThan(at);
    at = found;
  }
});
it('Nhà cung cấp tự điền theo nhà xe chạy chuyến — khớp id NCC trước, dự phòng tên (FB-097)', async () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} carrier={{ supplierId: 3, name: 'Tên hiển thị khác' }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhà cung cấp' }));
  expect(screen.queryByText('Chưa có nhà xe trên tuyến này — chọn thủ công.')).not.toBeInTheDocument();
  await fillRow(0, '5000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)[0]).toMatchObject({ payerKind: 'SUPPLIER', supplierId: 3 });
});
it('không khớp id NCC thì dự phòng theo tên nhà xe (FB-097)', async () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} carrier={{ supplierId: 99, name: 'nhà xe a' }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhà cung cấp' }));
  await fillRow(0, '5000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)[0]).toMatchObject({ supplierId: 3 });
});
it('không có nhà xe ngoài thì để chọn tay, không chặn lưu (FB-097)', async () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhà cung cấp' }));
  expect(screen.getByText('Chưa có nhà xe trên tuyến này — chọn thủ công.')).toBeInTheDocument();
  await fillRow(0, '5000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Chọn người chi hoặc nhà cung cấp.');
  fireEvent.click(screen.getByRole('button', { name: /Chọn nhà cung cấp/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhà xe A' }));
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)[0]).toMatchObject({ supplierId: 3 });
});
it('lưu xong giữ phiên nhập: ô của khoản trống, nhóm/bên thực chi/ngày giữ nguyên (FB-097)', async () => {
  const onClose = vi.fn();
  renderDrawer(<ExpenseCreateDrawer work={lotWork} catalog={catalog} onClose={onClose} />);
  const dateBefore = (screen.getByLabelText(/Ngày chi/) as HTMLInputElement).value;
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhân viên chi' }));
  fireEvent.click(screen.getByRole('button', { name: /Người chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Driver' }));
  fireEvent.click(screen.getByLabelText('Có hóa đơn'));
  fireEvent.change(screen.getByLabelText(/Số hóa đơn/), { target: { value: 'HD-9' } });
  await fillRow(0, '12000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('status')).toHaveTextContent('Đã lưu khoản chi.');
  expect(onClose).not.toHaveBeenCalled();
  // ô của từng khoản làm trống để nhập tiếp — dòng mới mở lại ở cờ TẮT, cặp
  // số/ngày ẩn nên không còn chữ sót lại từ khoản trước (SIL-949).
  expect(screen.getByLabelText(/Tên khoản chi/)).toHaveValue('');
  expect(screen.queryByLabelText(/Số hóa đơn/)).not.toBeInTheDocument();
  expect((screen.getAllByLabelText(/Thực chi/)[0] as HTMLInputElement).value).toBe('');
  // nhóm chi phí / bên thực chi / ngày giữ nguyên — the group lives on the
  // side-by-side panel (SIL-1028): the kept row stays in its group's panel.
  const lotPanel = screen.getByRole('region', { name: 'Nhóm chi phí: Chi phí lô hàng' });
  const roadPanel = screen.getByRole('region', { name: 'Nhóm chi phí: Tiền đường' });
  expect(within(lotPanel).getByLabelText(/Tên khoản chi/)).toHaveValue('');
  expect(within(roadPanel).queryByLabelText(/Tên khoản chi/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Bên thực chi/ })).toHaveTextContent('Nhân viên chi');
  expect((screen.getByLabelText(/Ngày chi/) as HTMLInputElement).value).toBe(dateBefore);
});
