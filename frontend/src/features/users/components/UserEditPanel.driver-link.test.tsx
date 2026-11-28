// QA 28/11 F-E — the Quản trị người dùng link control (the destination the
// batch-issue refusal names). Pins: the linked-profile read, the Mã-NV
// self-match + explicit pick link verb (with the driver row's version token),
// the NO-MATCH warning (a Mã NV with no unlinked profile SAYS SO — no silent
// success), and the unlink verb.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const trucksDriversMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: (options?: unknown) => trucksDriversMock(options),
}));

import { EditPanel } from './UserForm';

const DRIVER_USER = {
  id: 91,
  username: 'qa.payroll',
  fullName: 'Lê Văn QAPAY',
  email: null,
  phone: null,
  employeeCode: 'QAPAY1128',
  role: Role.DRIVER,
  status: 'ACTIVE',
  createdAt: '2026-11-14T00:00:00.000Z',
  driverId: null,
  driverName: null,
  driverStatus: null,
  assignedTruckId: null,
  baseSalary: null,
  socialInsurance: null,
};

const DRIVER_CATALOG = [
  { id: 7, userId: null, code: 'QAPAY1128', name: 'Lê Văn QAPAY (hồ sơ fleet)', status: 'ACTIVE', deletedAt: null, updatedAt: '2026-11-20T08:00:00.000Z' },
  { id: 8, userId: 42, code: 'LN-0091', name: 'Nguyễn Văn Đã Liên Kết', status: 'ACTIVE', deletedAt: null, updatedAt: '2026-11-20T08:00:00.000Z' },
  { id: 9, userId: null, code: 'QT-0100', name: 'Trần Văn Nghỉ', status: 'INACTIVE', deletedAt: null, updatedAt: '2026-11-20T08:00:00.000Z' },
];

function catalog(drivers = DRIVER_CATALOG) {
  return { trucks: [], drivers };
}

const PROPS = {
  isOpen: true,
  customerList: [],
  businessUnits: [],
  shipmentOptions: [],
  saving: false,
  error: null,
  onClose: vi.fn(),
  isMe: false,
  onLinkDriver: vi.fn(async () => true),
  onUnlinkDriver: vi.fn(async () => true),
};

function renderPanel(user: object, props: Partial<typeof PROPS> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditPanel {...PROPS} {...props} onSave={vi.fn(async () => true)} user={user as never} />
    </QueryClientProvider>,
  );
}

describe('EditPanel — Hồ sơ tài xế link control (QA 28/11 F-E)', () => {
  it('pre-picks the fleet profile matching the account Mã NV and links it with its version token', async () => {
    trucksDriversMock.mockReturnValue({ data: catalog(), refetch: vi.fn() });
    const onLinkDriver = vi.fn(async () => true);
    renderPanel(DRIVER_USER, { onLinkDriver });

    expect(await screen.findByText('Chưa liên kết hồ sơ tài xế — lệnh phát cho tài xế này sẽ không vào hộp thư của lái xe.')).toBeTruthy();
    // No "no match" alert: QAPAY1128 IS a live unlinked profile.
    expect(screen.queryByRole('alert')).toBeNull();
    // The UuiSelectField pre-picks the QAPAY1128 fleet record; pressing
    // [Liên kết hồ sơ] with no manual override links THAT profile with its
    // catalog version token (already-linked and INACTIVE catalog rows are
    // filtered out before the picker ever sees them).
    fireEvent.click(screen.getByRole('button', { name: 'Liên kết hồ sơ' }));
    await waitFor(() => expect(onLinkDriver).toHaveBeenCalledTimes(1));
    expect(onLinkDriver).toHaveBeenCalledWith(91, { id: 7, updatedAt: '2026-11-20T08:00:00.000Z' });
    // Success flips the section to the linked read without closing the panel.
    expect(await screen.findByText(/Đang liên kết/)).toBeTruthy();
  });

  it('says so when the account Mã NV matches no unlinked fleet profile (no silent success)', async () => {
    trucksDriversMock.mockReturnValue({ data: catalog([
      { id: 12, userId: null, code: 'OTHER-1', name: 'Người Khác', status: 'ACTIVE', deletedAt: null, updatedAt: '2026-11-20T08:00:00.000Z' },
    ]), refetch: vi.fn() });
    renderPanel(DRIVER_USER);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Không tìm thấy hồ sơ tài xế nào có mã NV "QAPAY1128"');
    expect(screen.getByRole('alert').textContent).toContain('chọn thủ công');
  });

  it('with an empty catalog the section says there is nothing to link, not silent success', async () => {
    trucksDriversMock.mockReturnValue({ data: catalog([]), refetch: vi.fn() });
    renderPanel(DRIVER_USER);
    // The Mã NV miss is named AND the empty-catalog state is stated.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Không tìm thấy hồ sơ tài xế nào có mã NV "QAPAY1128"');
  });

  it('a linked profile renders its read and [Hủy liên kết] clears it with the version token', async () => {
    trucksDriversMock.mockReturnValue({ data: catalog(), refetch: vi.fn() });
    const onUnlinkDriver = vi.fn(async () => true);
    renderPanel(
      { ...DRIVER_USER, driverId: 7, driverName: 'Lê Văn QAPAY (hồ sơ fleet)', driverStatus: 'ACTIVE' },
      { onUnlinkDriver },
    );

    expect(await screen.findByText('Lê Văn QAPAY (hồ sơ fleet)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy liên kết' }));
    await waitFor(() => expect(onUnlinkDriver).toHaveBeenCalledTimes(1));
    expect(onUnlinkDriver).toHaveBeenCalledWith({ id: 7, updatedAt: '2026-11-20T08:00:00.000Z' });
    expect(await screen.findByText(/Chưa liên kết hồ sơ tài xế/)).toBeTruthy();
  });
});
