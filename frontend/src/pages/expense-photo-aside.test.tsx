import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
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

// Receipt thumbnails sit behind the JWT, so the src is an Authorization-header
// blob fetch (DRV-DET-08 — never a `?token=` URL). The thumb opens the shared
// full-image viewer, and a read that fails swaps in a retryable hint.
describe('ExpensePhotoAside receipt thumbnails', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['abc'], { type: 'image/png' }));
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:receipt'),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('allows selecting receipt photos before the expense is saved', () => {
    const onUpload = vi.fn();
    render(<ExpensePhotoAside photos={[]} uploading={false} isEdit={false} submitting={false} handleBack={vi.fn()} removePhoto={vi.fn()} handlePhotoUpload={onUpload} />);
    const input = screen.getByLabelText('Chọn ảnh hóa đơn');
    fireEvent.change(input, { target: { files: [new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' })] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Lưu chi phí' })).toBeEnabled();
    expect(screen.queryByText(/duyệt/i)).toBeNull();
  });

  it('renders the thumb from an authenticated blob fetch instead of a ?token= URL', async () => {
    renderAside();

    const img = await screen.findByAltText('Ảnh 1') as HTMLImageElement;
    await waitFor(() => expect(img.getAttribute('src')).toBe('blob:receipt'));
    expect(api.getBlob).toHaveBeenCalledWith('/photos/expense-photos%2F2%2Fabc.png');
    expect(document.querySelector('img[src*="token="]')).toBeNull();
  });

  it('swaps a failed read for a retryable hint and refetches on retry', async () => {
    vi.mocked(api.getBlob).mockRejectedValue(new Error('403'));
    renderAside();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được ảnh');
    expect(api.getBlob).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    // Retry re-runs the read; it never re-uploads the file.
    await waitFor(() => expect(api.getBlob).toHaveBeenCalledTimes(2));
  });

  it('opens the full-image viewer from the thumb button', async () => {
    renderAside();
    await waitFor(() => expect(screen.getByAltText('Ảnh 1').getAttribute('src')).toBe('blob:receipt'));

    fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh hóa đơn 1' }));

    // The viewer mounts its own zoomable copy of the image beside the thumb.
    expect(screen.getAllByAltText('Ảnh 1').length).toBe(2);
  });
});
