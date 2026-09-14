import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Token cache the helper reads (lib/token) — pin it so assertions on the
// appended query param are deterministic.
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }));
vi.mock('../lib/token', () => ({ getToken: getTokenMock }));
vi.mock('../lib/api/photo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/photo')>();
  return actual;
});

import { ExpensePhotoAside } from './expense-entry-sections';

const PHOTOS = [{ id: 11, url: '/api/photos/expense-photos%2F2%2Fabc.png' }];

function renderAside(photos = PHOTOS) {
  return render(
    <ExpensePhotoAside
      photos={photos}
      uploading={false}
      isEdit
      submitting={false}
      handleBack={vi.fn()}
      removePhoto={vi.fn()}
      handlePhotoUpload={vi.fn()}
    />,
  );
}

// Receipt thumbnails sit behind the JWT — the raw URL 401s in an <img>. The
// src must carry the token, a failed load swaps in a retryable hint, and the
// thumb opens the shared full-image viewer.
describe('ExpensePhotoAside receipt thumbnails', () => {
  beforeEach(() => {
    getTokenMock.mockReturnValue('jwt-for-test');
  });

  it('wraps the img src with the auth token query param', () => {
    renderAside();
    const img = screen.getByAltText('Ảnh 1') as HTMLImageElement;
    expect(img.src).toContain('token=jwt-for-test');
    expect(img.src).toContain('/api/photos/expense-photos');
  });

  it('swaps a failed load for a retryable hint and reloads on retry', () => {
    const { container } = renderAside();
    const img = screen.getByAltText('Ảnh 1') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được ảnh');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    // Retry re-mounts the img (key bump) back to the loading state.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByAltText('Ảnh 1')).toBeTruthy();
  });

  it('opens the full-image viewer from the thumb button', () => {
    renderAside();
    fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh hóa đơn 1' }));
    // The viewer mounts its own zoomable copy of the image beside the thumb.
    expect(screen.getAllByAltText('Ảnh 1').length).toBe(2);
  });
});
