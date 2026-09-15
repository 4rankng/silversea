import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { upload }, fileCommandFingerprint: (file: File) => file.name }));
import { PendingPhotoUploadError, useTripFormPhotos } from './useTripFormPhotos';

describe('KSHIP-002: explicit online photo retry', () => {
  beforeEach(() => {
    upload.mockReset();
    let sequence = 0;
    URL.createObjectURL = vi.fn(() => `blob:photo-${++sequence}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('keeps failed trip files and publishes each successful preview before explicit retry', async () => {
    const { result } = renderHook(() => useTripFormPhotos(vi.fn()));
    upload.mockResolvedValue({});
    await act(async () => result.current.uploadPhotos([new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')] as unknown as FileList, undefined, 'CONTAINER'));
    upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ url: '/api/photos/b.jpg' });
    await act(async () => { await expect(result.current.flushPendingPhotos(9)).rejects.toBeInstanceOf(PendingPhotoUploadError); });
    expect(result.current.photoUrls).toEqual(['blob:photo-1', '/api/photos/b.jpg']);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:photo-1');
    const failedFingerprint = upload.mock.calls[2][2].retryFingerprint;
    const callsBeforeRetry = upload.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    expect(upload).toHaveBeenCalledTimes(callsBeforeRetry);
    upload.mockResolvedValueOnce({ url: '/api/photos/a.jpg' });
    await act(async () => result.current.flushPendingPhotos(9));
    expect(upload).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    expect(upload.mock.calls.at(-1)?.[2].retryFingerprint).toBe(failedFingerprint);
    expect(result.current.photoUrls).toEqual(['/api/photos/a.jpg', '/api/photos/b.jpg']);
  });

  it('retains a middle row upload and missing URLs, retries unresolved files only', async () => {
    const { result } = renderHook(() => useTripFormPhotos(vi.fn()));
    upload.mockResolvedValue({});
    await act(async () => {
      await result.current.uploadContainerPhoto(new File(['a'], 'a.jpg'), undefined, 'row', 'CONTAINER');
      await result.current.uploadContainerPhoto(new File(['b'], 'b.jpg'), undefined, 'row', 'SEAL');
      await result.current.uploadContainerPhoto(new File(['c'], 'c.jpg'), undefined, 'row', 'CONTAINER');
    });
    const replaced = vi.fn();
    upload.mockResolvedValueOnce({ photoUrl: '/api/photos/a.jpg' }).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({});
    await act(async () => { await expect(result.current.flushPendingContainerPhotos(9, new Map([['row', 12]]), replaced)).rejects.toMatchObject({ pendingCount: 2 }); });
    expect(replaced).toHaveBeenCalledWith('blob:photo-1', '/api/photos/a.jpg');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:photo-2');
    const callsBeforeRetry = upload.mock.calls.length;
    upload.mockResolvedValueOnce({ photoUrl: '/api/photos/b.jpg' }).mockResolvedValueOnce({ photoUrl: '/api/photos/c.jpg' });
    await act(async () => result.current.flushPendingContainerPhotos(9, new Map([['row', 12]]), replaced));
    expect(upload).toHaveBeenCalledTimes(callsBeforeRetry + 2);
    expect(replaced).toHaveBeenCalledTimes(3);
  });

  it('does not discard a row photo merely because its saved ID is missing', async () => {
    const { result } = renderHook(() => useTripFormPhotos(vi.fn()));
    upload.mockResolvedValue({});
    await act(async () => result.current.uploadContainerPhoto(new File(['a'], 'a.jpg'), undefined, 'row', 'CONTAINER'));
    await expect(result.current.flushPendingContainerPhotos(9, new Map())).rejects.toMatchObject({ pendingCount: 1 });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    act(() => result.current.revokeRowPhotos('row'));
    await expect(result.current.flushPendingContainerPhotos(9, new Map())).resolves.toEqual(new Map());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1');
  });
});
