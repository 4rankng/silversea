import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingCreate } from '@tingting/shared';
const createBatch = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { createBatch } }));
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
beforeEach(() => { createBatch.mockReset().mockResolvedValue({ items: [] }); });
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
it('lưu nhiều dòng một lần: hai dòng đi cùng một request, dòng sai thì không gọi API và nêu đúng số dòng', async () => {
  renderDrawer(<ExpenseCreateDrawer work={lotWork} catalog={catalog} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Thêm dòng' }));
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
it('cặp số/ngày hóa đơn hiển thị sẵn, tùy chọn; không còn ô Loại chứng từ (FB-097)', async () => {
  renderDrawer(<ExpenseCreateDrawer work={lotWork} catalog={catalog} onClose={vi.fn()} />);
  // FB-097 (TC-COSTUX-03): cặp số/ngày hóa đơn hiện sẵn, điền hoặc không đều được.
  expect(screen.queryByRole('button', { name: /Loại chứng từ/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Số hóa đơn/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Ngày hóa đơn/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Số hóa đơn/), { target: { value: 'HD-2026-09' } });
  await fillRow(0, '9000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(sentItems(0)[0]).toMatchObject({ invoiceNumber: 'HD-2026-09' });
  // để trống ở lần lưu sau → null, không có chữ sót lại từ khoản trước
  await fillRow(0, '1000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
  expect(sentItems(1)[0]).toMatchObject({ invoiceNumber: null, invoiceDate: null });
});
it('nhóm chi phí chỉ còn Chi phí lô hàng và Tiền đường', async () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Nhóm chi phí/ }));
  expect(await screen.findByRole('option', { name: 'Chi phí lô hàng' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Tiền đường' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Giao nhận Ops' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Phát sinh Ops' })).not.toBeInTheDocument();
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
it('OPS context chỉ chọn người thực chi là Ops; lưu được khi đã chọn người chi', async () => {
  const onClose = vi.fn(); const onSaved = vi.fn();
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} entryScope="OPS" onClose={onClose} onSaved={onSaved} />);
  await fillRow(0, '1000', '7000');
  // PM ruling: mặc định vẫn là công ty trả trực tiếp; chủ động đổi sang người chi.
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhân viên chi' }));
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  expect(createBatch).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent('Chọn người chi hoặc nhà cung cấp.');
  fireEvent.click(screen.getByRole('button', { name: /Người thực chi/ }));
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
  fireEvent.click(screen.getByRole('button', { name: /Người thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Driver' }));
  fireEvent.change(screen.getByLabelText(/Số hóa đơn/), { target: { value: 'HD-9' } });
  await fillRow(0, '12000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));
  await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('status')).toHaveTextContent('Đã lưu khoản chi.');
  expect(onClose).not.toHaveBeenCalled();
  // ô của từng khoản làm trống để nhập tiếp
  expect(screen.getByLabelText(/Tên khoản chi/)).toHaveValue('');
  expect(screen.getByLabelText(/Số hóa đơn/)).toHaveValue('');
  expect((screen.getAllByLabelText(/Thực chi/)[0] as HTMLInputElement).value).toBe('');
  // nhóm chi phí / bên thực chi / ngày giữ nguyên
  expect(screen.getByRole('button', { name: /Nhóm chi phí/ })).toHaveTextContent('Chi phí lô hàng');
  expect(screen.getByRole('button', { name: /Bên thực chi/ })).toHaveTextContent('Nhân viên chi');
  expect((screen.getByLabelText(/Ngày chi/) as HTMLInputElement).value).toBe(dateBefore);
});
