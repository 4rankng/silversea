import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';
import type { BusinessUnit } from '../utils';
import { BusinessUnitsManager } from './BusinessUnitsManager';

const { updateBusinessUnit, createBusinessUnit, deactivateBusinessUnit } = vi.hoisted(() => ({
  updateBusinessUnit: vi.fn(),
  createBusinessUnit: vi.fn(),
  deactivateBusinessUnit: vi.fn(),
}));

vi.mock('../../../api/userClient', () => ({
  userClient: { updateBusinessUnit, createBusinessUnit, deactivateBusinessUnit },
}));

vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const units: BusinessUnit[] = [
  { id: 7, code: 'HCM', name: 'Điều hành miền Nam', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-05T01:00:00.000Z' },
];

// Card 367 law pin (docs/design-guidelines.md §2026-10-05): a 4xx business
// refusal renders the API's error message verbatim — never copy that hides it.
describe('BusinessUnitsManager save errors surface the API reason', () => {
  it('a duplicate-code refusal shows the backend message, not the conflict copy', async () => {
    updateBusinessUnit.mockRejectedValueOnce(
      new ApiError(409, { error: 'Mã hoặc tên đơn vị phụ trách đã tồn tại', code: 'DUPLICATE_CODE' }, 'Mã hoặc tên đơn vị phụ trách đã tồn tại'),
    );
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<BusinessUnitsManager businessUnits={units} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    const banner = await screen.findByText('Mã hoặc tên đơn vị phụ trách đã tồn tại');
    expect(banner).toBeTruthy();
    // The refusal must not be misfiled as a version conflict: no wrong copy,
    // no spurious refetch.
    expect(screen.queryByText(/Đơn vị đã được cập nhật ở nơi khác/)).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a version conflict surfaces the API reason and refetches a fresh token', async () => {
    updateBusinessUnit.mockRejectedValueOnce(
      new ApiError(409, { error: 'Phiên bản đã thay đổi' }, 'Phiên bản đã thay đổi'),
    );
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<BusinessUnitsManager businessUnits={units} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    // Card 367 law: the backend's precise 409 reason renders verbatim; the
    // recovery copy is the fallback for refusals without a business reason.
    await screen.findByText('Phiên bản đã thay đổi');
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('a conflict with no business reason keeps the recovery copy and refetches', async () => {
    updateBusinessUnit.mockRejectedValueOnce({ status: 409 });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<BusinessUnitsManager businessUnits={units} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    await screen.findByText('Đơn vị đã được cập nhật ở nơi khác — đã tải lại bản mới nhất. Kiểm tra thông tin rồi lưu lại.');
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('card 367 prescribed shape: a plain {status: 409, message} refusal shows that message', async () => {
    updateBusinessUnit.mockRejectedValueOnce({ status: 409, message: 'Đơn vị này đang được duyệt bởi Phòng Tài chính.' });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<BusinessUnitsManager businessUnits={units} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    await screen.findByText('Đơn vị này đang được duyệt bởi Phòng Tài chính.');
  });

  it('a duplicate refusal in plain shape shows the backend message and is not misfiled', async () => {
    updateBusinessUnit.mockRejectedValueOnce({ status: 409, code: 'DUPLICATE_CODE', message: 'Mã BP-01 đã tồn tại trong hệ thống.' });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<BusinessUnitsManager businessUnits={units} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    await screen.findByText('Mã BP-01 đã tồn tại trong hệ thống.');
    expect(screen.queryByText(/Đơn vị đã được cập nhật ở nơi khác/)).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
