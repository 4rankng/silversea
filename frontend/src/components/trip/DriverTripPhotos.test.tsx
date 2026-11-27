// QA: the "Số cont & seal" photo tiles must never paint the browser's raw
// broken-image glyph. A read that succeeds but hands back bytes the browser
// cannot decode (truncated/corrupt stored file) falls back to the same calm
// labelled placeholder an absent photo gets — the strip's "Ảnh 2/3" header
// never coexists with a broken tile.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api/client';
import { setToken } from '../../lib/token';
import { BentoThumb } from './DriverTripPhotos';

describe('BentoThumb decode-failure fallback', () => {
  beforeEach(() => {
    setToken('test-token');
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:object-container'),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('falls back to the calm placeholder when the blob cannot be decoded', async () => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['JUNK'], { type: 'image/jpeg' }));
    render(<BentoThumb photoKey="trips/95/container-image.jpg" label="Cont" />);

    const img = await waitFor(() => screen.getByRole('img', { name: 'Ảnh cont' }));
    fireEvent.error(img);

    // The broken <img> is gone; the labelled empty tile replaces it.
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    expect(screen.getByText('Cont')).toBeTruthy();
  });

  it('keeps the image mounted when it decodes fine', async () => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['\uFFFDPNG-DATA'], { type: 'image/jpeg' }));
    render(<BentoThumb photoKey="trips/95/container-image.jpg" label="Cont" />);

    await waitFor(() => expect(screen.getByRole('img', { name: 'Ảnh cont' })).toBeTruthy());
  });
});
