import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

describe('CommandPalette', () => {
  it('runs the tapped command without requiring a preceding mouse hover', () => {
    const first = vi.fn();
    const second = vi.fn();
    const close = vi.fn();
    render(<CommandPalette open commands={[{ id: 'first', label: 'Khách hàng', run: first }, { id: 'second', label: 'Điều vận', run: second }]} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Điều vận' }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('announces keyboard selection and does not run a command when Enter is pressed on Close', () => {
    const first = vi.fn();
    const second = vi.fn();
    const close = vi.fn();
    render(<CommandPalette open commands={[{ id: 'first', label: 'Khách hàng', run: first }, { id: 'second', label: 'Điều vận', run: second }]} onClose={close} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toHaveTextContent('Điều vận');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(second).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Đóng bảng lệnh' }), { key: 'Enter' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
