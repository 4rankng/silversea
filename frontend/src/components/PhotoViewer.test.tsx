import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhotoViewer } from './PhotoViewer';

describe('PhotoViewer interactions', () => {
  it('contains focus, closes only the viewer with Escape and restores its opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const parentEscape = vi.fn();
    window.addEventListener('keydown', parentEscape);
    const onClose = vi.fn();
    const { unmount } = render(<PhotoViewer urls={['/photo.jpg']} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Xem ảnh chứng từ' })).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Đóng ảnh' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toHaveFocus();
    parentEscape.mockClear();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentEscape).not.toHaveBeenCalled();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
    window.removeEventListener('keydown', parentEscape);
  });

  it('offers retry for an unavailable image and resets zoom when moving to another image', () => {
    render(<PhotoViewer urls={['/first.jpg', '/second.jpg']} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải ảnh');
    const image = screen.getByAltText('Ảnh 1');
    fireEvent.error(image);
    expect(screen.getByRole('status')).toHaveTextContent('Không tải được ảnh');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(screen.getByAltText('Ảnh 1')).not.toBe(image);
    fireEvent.load(screen.getByAltText('Ảnh 1'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByAltText('Ảnh 2')).toHaveAttribute('src', '/second.jpg');
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải ảnh');
  });
});
