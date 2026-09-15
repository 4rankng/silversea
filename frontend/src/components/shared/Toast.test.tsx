import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }));
vi.mock('animejs', () => ({
  animate: vi.fn(() => ({ pause: vi.fn() })),
  createScope: vi.fn(() => ({ revert: vi.fn() })),
  utils: { set: vi.fn() },
  spring: vi.fn(),
}));

function Controls() {
  const { toast } = useToast();
  return <>
    <button onClick={() => toast({ kind: 'success', message: 'Đã lưu lô hàng.' })}>Lưu</button>
    <button onClick={() => toast({ kind: 'error', message: 'Chưa tải được dữ liệu.' })}>Tải lại</button>
  </>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Toast announcements', () => {
  it('mounts the live region before messages arrive and adds feedback without moving focus', () => {
    render(<ToastProvider><Controls /></ToastProvider>);
    const region = screen.getByRole('log', { name: 'Thông báo' });
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-relevant', 'additions text');
    const save = screen.getByRole('button', { name: 'Lưu' });
    save.focus();
    fireEvent.click(save);
    expect(screen.getByRole('log')).toBe(region);
    expect(within(region).getByText('Đã lưu lô hàng.')).toBeInTheDocument();
    expect(save).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(within(region).getByText('Chưa tải được dữ liệu.')).toBeInTheDocument();
    expect(save).toHaveFocus();
  });

  it('retains duplicate suppression and keeps the same live region after dismissal', () => {
    render(<ToastProvider><Controls /></ToastProvider>);
    const region = screen.getByRole('log');
    const save = screen.getByRole('button', { name: 'Lưu' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(within(region).getAllByText('Đã lưu lô hàng.')).toHaveLength(1);
    fireEvent.click(within(region).getByRole('button', { name: 'Đóng thông báo' }));
    expect(region).toBeEmptyDOMElement();
    expect(screen.getByRole('log')).toBe(region);
    fireEvent.click(save);
    expect(within(region).getByText('Đã lưu lô hàng.')).toBeInTheDocument();
  });
});
