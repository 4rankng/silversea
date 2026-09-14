import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpsModalBackdrop } from './OpsModalBackdrop';

describe('OpsModalBackdrop', () => {
  it('contains focus, preserves the opener across rerenders and restores scroll on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const originalOverflow = document.body.style.overflow;
    const { unmount, rerender } = render(<OpsModalBackdrop ariaLabel="Chi phí" onClose={vi.fn()}><div className="ops-modal"><button>Đóng</button><button>Lưu</button></div></OpsModalBackdrop>);
    expect(document.body.style.overflow).toBe('hidden');
    screen.getByRole('button', { name: 'Lưu' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    rerender(<OpsModalBackdrop ariaLabel="Chi phí" onClose={vi.fn()}><div className="ops-modal"><button>Đóng</button><button>Lưu</button></div></OpsModalBackdrop>);
    unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe(originalOverflow);
    opener.remove();
  });

  it('ignores Escape from a portaled child picker but dismisses from its own controls', () => {
    const onClose = vi.fn();
    render(<OpsModalBackdrop ariaLabel="Chi phí" onClose={onClose}><div className="ops-modal"><button>Lưu</button></div></OpsModalBackdrop>);
    const picker = document.createElement('button');
    document.body.append(picker);
    fireEvent.keyDown(picker, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lưu' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    picker.remove();
  });
});
