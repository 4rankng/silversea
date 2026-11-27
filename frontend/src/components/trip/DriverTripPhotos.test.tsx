// QA: the "Số cont & seal" photo tiles must never paint the browser's raw
// broken-image glyph, and the three slot states must stay distinguishable —
// SIL-1208: an EMPTY slot (never had a photo) shows the camera as the upload
// affordance; a photo that IS on file but cannot be read keeps the error
// affordance (SIL-1130); a read still in flight shows the spinner. The
// strip's "Ảnh 2/3" header never coexists with a broken tile.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api/client';
import { ApiError } from '../../lib/api';
import { setToken } from '../../lib/token';
import { BentoThumb } from './DriverTripPhotos';

/** The tile face of one bento slot — the box that carries the glyph. */
function slotTile(container: HTMLElement) {
  const tile = container.querySelector('.dcc-bento__thumb-empty');
  expect(tile).toBeTruthy();
  return tile as HTMLElement;
}

describe('BentoThumb slot states', () => {
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

  // SIL-1208 — the driver opens an empty Cont/Seal slot to ADD a photo, so
  // the slot must offer the camera, never the crossed-out picture (which
  // would read as "broken image" on a slot that never had a photo).
  it('an empty slot offers the camera glyph, never the crossed-out picture', () => {
    const { container } = render(<BentoThumb photoKey={null} label="Cont" />);

    const tile = slotTile(container);
    expect(tile.querySelector('svg.lucide-camera')).toBeTruthy();
    expect(tile.querySelector('svg.lucide-image-off')).toBeNull();
    expect(screen.getByText('Cont')).toBeTruthy();
  });

  it('a photo still being read shows the spinner, never the error glyph', async () => {
    let resolveBlob: (blob: Blob) => void = () => {};
    vi.spyOn(api, 'getBlob').mockImplementation(() => new Promise<Blob>((resolve) => { resolveBlob = resolve; }));
    const { container } = render(<BentoThumb photoKey="trips/95/container-image.jpg" label="Cont" />);

    expect(screen.getByText('Đang tải…')).toBeTruthy();
    expect(slotTile(container).querySelector('svg.lucide-image-off')).toBeNull();

    resolveBlob(new Blob(['\uFFFDPNG-DATA'], { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Ảnh cont' })).toBeTruthy());
  });

  it('falls back to the error affordance when the blob cannot be decoded', async () => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['JUNK'], { type: 'image/jpeg' }));
    const { container } = render(<BentoThumb photoKey="trips/95/container-image.jpg" label="Cont" />);

    const img = await waitFor(() => screen.getByRole('img', { name: 'Ảnh cont' }));
    fireEvent.error(img);

    // The broken <img> is gone; the error tile replaces it — a photo IS on
    // file, so the camera of an empty slot would be a lie.
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    const tile = slotTile(container);
    expect(tile.querySelector('svg.lucide-image-off')).toBeTruthy();
    expect(tile.querySelector('svg.lucide-camera')).toBeNull();
    expect(screen.getByText('Lỗi tải')).toBeTruthy();
    // The slot keeps its identity (which photo this is).
    expect(screen.getByText('Cont')).toBeTruthy();
  });

  it('keeps the image mounted when it decodes fine', async () => {
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['\uFFFDPNG-DATA'], { type: 'image/jpeg' }));
    render(<BentoThumb photoKey="trips/95/container-image.jpg" label="Cont" />);

    await waitFor(() => expect(screen.getByRole('img', { name: 'Ảnh cont' })).toBeTruthy());
  });

  // UI-13 (QA 27/11, trip 36): a storage key the backend no longer serves
  // (purged file, stale wire row) must never reach the driver as a broken
  // image — the denied read resolves to '' and the error tile stands in,
  // keeping the "Ảnh n/3" strip honest.
  it('falls back to the error affordance when the storage read 404s', async () => {
    const getBlob = vi.spyOn(api, 'getBlob').mockRejectedValue(new ApiError(404, {}, 'Không tìm thấy ảnh.'));
    const { container } = render(<BentoThumb photoKey="trips/36/dead-container-key.jpg" label="Cont" />);

    await waitFor(() => expect(getBlob).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Lỗi tải')).toBeTruthy());
    expect(screen.queryByRole('img')).toBeNull();
    const tile = slotTile(container);
    expect(tile.querySelector('svg.lucide-image-off')).toBeTruthy();
    expect(tile.querySelector('svg.lucide-camera')).toBeNull();
  });
});
