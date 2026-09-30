import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PhotoViewer } from './PhotoViewer';
import { Modal } from '../design-system/Modal';

describe('PhotoViewer interactions', () => {
  it('contains focus, closes only the viewer with Escape and restores its opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    // The old capture-phase stopPropagation pin is superseded by the module's
    // overlay-token stack (card 20261001_251): the TOPMOST overlay owns
    // Escape, so a viewer opened inside a dialog closes ONLY itself.
    const parentOnClose = vi.fn();
    function Host() {
      const [viewerOpen, setViewerOpen] = useState(true);
      return (
        <Modal isOpen onClose={parentOnClose} title="Ảnh chứng từ chuyến">
          {viewerOpen && <PhotoViewer urls={['/photo.jpg']} onClose={() => setViewerOpen(false)} />}
        </Modal>
      );
    }
    const { unmount } = render(<Host />);
    expect(screen.getByRole('dialog', { name: 'Xem ảnh chứng từ' })).toBeInTheDocument();
    const first = screen.getByRole('button', { name: 'Thu nhỏ' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Đóng ảnh' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xem ảnh chứng từ' })).toBeNull());
    expect(parentOnClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Ảnh chứng từ chuyến' })).toBeInTheDocument();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
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
