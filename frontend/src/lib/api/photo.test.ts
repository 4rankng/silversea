import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setToken } from '../token';
import { api } from './client';
import { photoRoutePath, useAuthedPhotoUrl, useAuthedPhotoUrls } from './photo';

describe('photoRoutePath', () => {
  it('encodes a bare storage key into the authenticated photo route', () => {
    expect(photoRoutePath('trips/95/container-image.jpg')).toBe('/photos/trips%2F95%2Fcontainer-image.jpg');
  });

  it('passes an already-formed route through and rejects empty/preview values', () => {
    expect(photoRoutePath('/api/photos/denied.jpg')).toBe('/photos/denied.jpg');
    expect(photoRoutePath('/photos/trips%2F95%2Fcontainer-image.jpg')).toBe('/photos/trips%2F95%2Fcontainer-image.jpg');
    expect(photoRoutePath('blob:https://vantai.tingting.vip/preview-id')).toBeNull();
    expect(photoRoutePath(null)).toBeNull();
    expect(photoRoutePath('   ')).toBeNull();
  });

  it('composes with the actual client base exactly once without double-encoding the key', () => {
    const reference = '/api/photos/trips%2F95%2Fcontainer-image.jpg';
    expect(`${import.meta.env.VITE_API_BASE || '/api'}${photoRoutePath(reference)}`)
      .toBe(`${import.meta.env.VITE_API_BASE || '/api'}/photos/trips%2F95%2Fcontainer-image.jpg`);
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
    expect(getBlob).toHaveBeenCalledWith('/photos/trips%2F95%2Fcontainer-image.jpg');
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

  it('refetches the same values when the retry key changes', async () => {
    const getBlob = vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['abc']));

    const { result, rerender } = renderHook(
      ({ retry }: { retry: number }) => useAuthedPhotoUrls(['trips/95/a.jpg'], retry),
      { initialProps: { retry: 0 } },
    );
    await waitFor(() => expect(result.current[0]).toBe('blob:object-3'));

    rerender({ retry: 1 });

    await waitFor(() => expect(getBlob).toHaveBeenCalledTimes(2));
  });

  it('empties the batch while a changed list refetches, so no stale URL survives under a new value', async () => {
    const getBlob = vi.spyOn(api, 'getBlob').mockResolvedValueOnce(new Blob(['a']));
    const { result, rerender } = renderHook(
      ({ values }: { values: string[] }) => useAuthedPhotoUrls(values),
      { initialProps: { values: ['trips/95/a.jpg'] } },
    );
    await waitFor(() => expect(result.current).toEqual(['blob:object-1']));

    let release: (() => void) | undefined;
    getBlob.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(new Blob(['abcde'])); }));
    await act(async () => { rerender({ values: ['trips/95/b.jpg'] }); });

    // In flight: the removed photo's URL must not linger under the new value.
    expect(result.current).toEqual([]);

    await act(async () => { release?.(); });
    await waitFor(() => expect(result.current).toEqual(['blob:object-5']));
  });
});

describe('useAuthedPhotoUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => `blob:object-${blob.size}`),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves a single value, and an absent one to an empty string', async () => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['abc']));

    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) => useAuthedPhotoUrl(value),
      { initialProps: { value: 'trips/95/a.jpg' as string | null } },
    );
    await waitFor(() => expect(result.current).toBe('blob:object-3'));

    rerender({ value: null });

    await waitFor(() => expect(result.current).toBe(''));
  });
});
