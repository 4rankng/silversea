import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { setToken } from '../token';
import { api } from './client';
import { photoSrc, useAuthedPhotoUrls } from './photo';

// DEPRECATED shim: still pinned because unrelated surfaces (trip-detail cards,
// ops expense modals) have not migrated yet. Delete this block with the
// `photoSrc` export once the last `?token=` call site is gone (DRV-DET-08).
describe('photoSrc (deprecated ?token= shim)', () => {
  beforeEach(() => {
    setToken('test-token');
  });

  it('preserves a pending browser object URL for immediate preview', () => {
    const objectUrl = 'blob:https://vantai.tingting.vip/preview-id';

    expect(photoSrc(objectUrl)).toBe(objectUrl);
  });

  it('keeps persisted storage keys behind the authenticated photo route', () => {
    expect(photoSrc('trips/95/container-image.jpg')).toBe(
      '/api/photos/trips%2F95%2Fcontainer-image.jpg?token=test-token',
    );
  });
});

// DRV-DET-08: evidence photos load with the Authorization header and render
// from an object URL — a JWT must never ride in the query string, where browser
// history, Referer headers and proxy logs capture it.
describe('useAuthedPhotoUrls', () => {
  beforeEach(() => {
    setToken('test-token');
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => `blob:object-${blob.size}`),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes a pending browser object URL through without fetching', async () => {
    const getBlob = vi.spyOn(api, 'getBlob');

    const { result } = renderHook(() => useAuthedPhotoUrls(['blob:local-preview']));

    await waitFor(() => expect(result.current[0]).toBe('blob:local-preview'));
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('fetches the photo route through the api client and returns an object URL', async () => {
    const getBlob = vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['abc']));

    const { result } = renderHook(() => useAuthedPhotoUrls(['trips/95/container-image.jpg']));

    await waitFor(() => expect(result.current[0]).toBe('blob:object-3'));
    // The protected path travels as an authenticated request path, never as a
    // rendered URL carrying the token.
    expect(getBlob).toHaveBeenCalledWith('/api/photos/trips%2F95%2Fcontainer-image.jpg');
    expect(result.current[0]).not.toContain('token=');
  });

  it('resolves a failed read to an empty slot instead of the protected URL', async () => {
    vi.spyOn(api, 'getBlob').mockRejectedValue(new Error('403'));

    const { result } = renderHook(() => useAuthedPhotoUrls(['/api/photos/denied.jpg']));

    await waitFor(() => expect(result.current[0]).toBe(''));
  });

  it('revokes every object URL it created on unmount', async () => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['abc']));

    const { result, unmount } = renderHook(() => useAuthedPhotoUrls(['trips/95/a.jpg']));
    await waitFor(() => expect(result.current[0]).toBe('blob:object-3'));

    unmount();

    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:object-3');
  });
});
