import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CusLotDrawerFooter } from './CusLotDrawerFooter';

describe('CusLotDrawerFooter (SIL-748, SIL-1150)', () => {
  it('renders [Khai chi phí] button when onDeclareExpense is provided and handles click', () => {
    const onDeclareExpense = vi.fn();
    render(
      <CusLotDrawerFooter
        onOpenLedger={vi.fn()}
        onDeclareExpense={onDeclareExpense}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Khai chi phí' });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onDeclareExpense).toHaveBeenCalledTimes(1);
  });

  it('does not render [Khai chi phí] button when onDeclareExpense is omitted', () => {
    render(<CusLotDrawerFooter onOpenLedger={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Khai chi phí' })).toBeNull();
  });

  it('routes to the container ledger and never renders a "Sửa" navigation (SIL-1150)', () => {
    // The drawer body is the shared lot form now (KB §3.1.7) — the old
    // "Sửa" route to /shipments/:id/edit left with its lock/disable cluster.
    const onOpenLedger = vi.fn();
    render(<CusLotDrawerFooter onOpenLedger={onOpenLedger} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mở bảng chi tiết container' }));
    expect(onOpenLedger).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByText('Lô đã khóa kế toán — dữ liệu chỉ đọc.')).toBeNull();
  });
});
