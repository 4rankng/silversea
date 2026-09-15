import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpenseReceiptPhotos } from './useExpenseReceiptPhotos';

const { upload, remove, toast } = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), toast: vi.fn() }));
vi.mock('../../lib/api', () => ({ api: { upload, delete: remove, get: vi.fn() }, fileCommandFingerprint: (file: File) => file.name }));
vi.mock('../../components/shared/Toast', () => ({ useToast: () => ({ toast }) }));

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(file => `blob:${(file as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

describe('expense creation receipts', () => {
  it('retries only the failed receipt against the saved expense and reuses its idempotency fingerprint', async () => {
    const { result } = renderHook(() => useExpenseReceiptPhotos(undefined, 44));
    // The initial creation stage has no persisted id; use a separate hook for its local queue.
    const pending = renderHook(() => useExpenseReceiptPhotos(undefined, null));
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    await act(async () => pending.result.current.handlePhotoUpload([first] as unknown as FileList));
    await act(async () => pending.result.current.handlePhotoUpload([second] as unknown as FileList));
    expect(upload).not.toHaveBeenCalled();
    upload.mockResolvedValueOnce({ id: 1, url: '/api/photos/first' }).mockRejectedValueOnce(new Error('network'));
    await act(async () => { await expect(pending.result.current.savePendingPhotos(44)).rejects.toThrow('không tạo thêm phiếu'); });
    expect(pending.result.current.photos.map(p => p.id)).toEqual([1, -2]);
    upload.mockResolvedValueOnce({ id: 2, url: '/api/photos/second' });
    await act(async () => pending.result.current.savePendingPhotos(44));
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls.map(call => call[0])).toEqual(Array(3).fill('/expenses/44/photos'));
    expect(upload.mock.calls[1][2]).toEqual(upload.mock.calls[2][2]);
    expect(pending.result.current.photos.map(p => p.id)).toEqual([1, 2]);
    expect(result.current.uploading).toBe(false);
  });

  it('removing an unsaved receipt only clears the local preview', async () => {
    const { result } = renderHook(() => useExpenseReceiptPhotos(undefined, null));
    await act(async () => result.current.handlePhotoUpload([new File(['x'], 'receipt.png', { type: 'image/png' })] as unknown as FileList));
    await act(async () => result.current.removePhoto(0));
    expect(result.current.photos).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt.png');
  });
});
