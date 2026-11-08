import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CusLotDrawerFooter } from './CusLotDrawerFooter';

describe('CusLotDrawerFooter (SIL-748)', () => {
  it('renders [Khai chi phí] button when onDeclareExpense is provided and handles click', () => {
    const onDeclareExpense = vi.fn();
    render(
      <CusLotDrawerFooter
        canEdit={false}
        locked={false}
        onEdit={vi.fn()}
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
    render(
      <CusLotDrawerFooter
        canEdit={false}
        locked={false}
        onEdit={vi.fn()}
        onOpenLedger={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Khai chi phí' })).toBeNull();
  });
});
