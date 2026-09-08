import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CusDrawerFooter } from './CusDrawerFooter';

describe('CusDrawerFooter', () => {
  it('does not render "Chưa có thay đổi" when isDirty is false', () => {
    const { container } = render(
      <CusDrawerFooter
        isDirty={false}
        isSaving={false}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByText('Chưa có thay đổi')).toBeNull();
    expect(container.querySelector('.cus-drawer-footer__clean-note')).toBeNull();
    expect(container.querySelector('.cus-drawer-footer__dirty-note')).toBeNull();

    const saveBtn = screen.getByRole('button', { name: 'Lưu' });
    const discardBtn = screen.getByRole('button', { name: 'Hủy' });
    expect(saveBtn).toBeDisabled();
    expect(discardBtn).toBeDisabled();
  });

  it('renders dirty note and enables buttons when isDirty is true', () => {
    const handleSave = vi.fn();
    const handleDiscard = vi.fn();

    render(
      <CusDrawerFooter
        isDirty={true}
        isSaving={false}
        onDiscard={handleDiscard}
        onSave={handleSave}
      />,
    );

    expect(screen.getByText('Có thay đổi container chưa lưu')).toBeDefined();

    const saveBtn = screen.getByRole('button', { name: 'Lưu' });
    const discardBtn = screen.getByRole('button', { name: 'Hủy' });
    expect(saveBtn).not.toBeDisabled();
    expect(discardBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    expect(handleSave).toHaveBeenCalledTimes(1);

    fireEvent.click(discardBtn);
    expect(handleDiscard).toHaveBeenCalledTimes(1);
  });

  it('shows saving indicator and disables buttons when isSaving is true', () => {
    render(
      <CusDrawerFooter
        isDirty={true}
        isSaving={true}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('Đang lưu…')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
  });
});
