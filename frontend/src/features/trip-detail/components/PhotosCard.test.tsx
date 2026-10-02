import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhotosCard } from './PhotosCard';

describe('PhotosCard unavailable source boundary', () => {
  it('keeps an empty resolved slot out of img sources and the viewer', async () => {
    render(<PhotosCard photoUrls={['blob:local-preview', '']} />);
    await waitFor(() => expect(screen.getByAltText('Ảnh 1')).toHaveAttribute('src', 'blob:local-preview'));
    expect(document.querySelector('img[src=""]')).toBeNull();
    const unavailable = screen.getByRole('button', { name: 'Ảnh 2 (không tải được)' });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveTextContent('Không tải được');
    fireEvent.click(unavailable);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh 1' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Xem ảnh chứng từ' })).toBeVisible());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
