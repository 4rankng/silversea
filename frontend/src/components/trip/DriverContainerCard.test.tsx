import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverContainerCard } from './DriverContainerCard';

const toastSpy = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api', () => ({
  api: {
    upload: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  fileCommandFingerprint: () => 'test-fingerprint',
  getAuthenticatedPhotoUrl: (url: string) => url,
}));

vi.mock('../../lib/imageCompression', () => ({
  // Pass the file through untouched — the burn-in contract is covered by
  // imageCompression.test.ts; here we only need the upload payload flow.
  compressImageFile: async (file: File) => file,
}));

vi.mock('../shared/Toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('../shared/ContainerScanner', () => ({
  ContainerScanner: ({ onCapture }: { onCapture: (dataUrl: string) => void }) => (
    <button type="button" onClick={() => onCapture('data:image/jpeg;base64,Zm9v')}>
      fake-scanner-capture
    </button>
  ),
  dataUrlToFile: (dataUrl: string) => new File([dataUrl], 'photo.jpg', { type: 'image/jpeg' }),
}));

import { api } from '../../lib/api';

const uploadMock = vi.mocked(api.upload);

function declaredContainer(containerNumber: string) {
  return {
    id: 11,
    updatedAt: '2026-08-28T08:30:22.675Z',
    containerNumber,
    sealNumber: 'SL0001',
    containerTypeId: 3,
    containerTypeName: "40'HC",
    containerTypeCode: '40HC',
    cargoWeightKg: null,
  };
}

function renderCard(overrides: Partial<Parameters<typeof DriverContainerCard>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <DriverContainerCard
      tripId={55}
      containers={[]}
      contPhotoKey={null}
      sealPhotoKey={null}
      deliveryNotePhotoKey={null}
      tradeDirection="IMPORT"
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onSaved };
}

/** Opens the container capture zone and feeds one OCR result through the
 *  (faked) scanner, as if the driver photographed a container plate. When a
 *  container is already on file (the declared number), the card starts in the
 *  read-only bento view — enter edit mode first. Phần 4 ticket 2026-08-28:
 *  the primary capture button is now a file-picker label; the scanner overlay
 *  is opened by the secondary "Mở camera cont" button. */
async function scanContainer(ocrResult: Record<string, unknown>) {
  uploadMock.mockResolvedValueOnce(ocrResult as never);
  const editButton = screen.queryByRole('button', { name: /Sửa/ });
  if (editButton) fireEvent.click(editButton);
  fireEvent.click(screen.getByRole('button', { name: /Mở camera cont/ }));
  fireEvent.click(screen.getByText('fake-scanner-capture'));
  await waitFor(() => expect(uploadMock).toHaveBeenCalled());
}

describe('DriverContainerCard — spec A6 OCR cross-check', () => {
  it('IMPORT: warns when the scanned number differs from the declared number', async () => {
    renderCard({ containers: [declaredContainer('MSKU1234567')], tradeDirection: 'IMPORT' });

    await scanContainer({ ok: true, containerNumbers: ['TCKU7654321'], photoUrl: '/api/photos/x' });

    const banner = await screen.findByTestId('container-scan-mismatch');
    expect(banner.textContent).toContain('TCKU7654321');
    expect(banner.textContent).toContain('MSKU1234567');
    // OCR pre-fills the editable number; the advisory never blocks editing.
    expect((screen.getByDisplayValue('TCKU7654321') as HTMLInputElement).disabled).toBe(false);
  });

  it('IMPORT: no warning when the scanned number matches the declared number', async () => {
    renderCard({ containers: [declaredContainer('TCKU7654321')], tradeDirection: 'IMPORT' });

    await scanContainer({ ok: true, containerNumbers: ['TCKU7654321'], photoUrl: '/api/photos/x' });

    expect(await screen.findByDisplayValue('TCKU7654321')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId('container-scan-mismatch')).toBeNull(),
    );
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('EXPORT: auto-fills without any declared-number cross-check', async () => {
    renderCard({ containers: [declaredContainer('MSKU1234567')], tradeDirection: 'EXPORT' });

    await scanContainer({ ok: true, containerNumbers: ['TCKU7654321'], photoUrl: '/api/photos/x' });

    expect(await screen.findByDisplayValue('TCKU7654321')).toBeTruthy();
    expect(screen.queryByTestId('container-scan-mismatch')).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'info' }));
  });
});

describe('DriverContainerCard — saved rows with null fields', () => {
  it('opens Sửa without crashing when the saved container number is null (seal-only save)', () => {
    renderCard({
      containers: [{ ...declaredContainer('MSKU1234567'), containerNumber: null, sealNumber: 'SL-only' }],
    });
    // Prod crash: tapping Sửa seeded the draft with null and the render-time
    // ISO-6346 check called .trim() on it before the form could paint.
    fireEvent.click(screen.getByRole('button', { name: /Sửa/ }));
    const sealInput = screen.getByDisplayValue('SL-only') as HTMLInputElement;
    expect(sealInput).toBeTruthy();
    expect(screen.getAllByDisplayValue('').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeTruthy();
  });
});

describe('DriverContainerCard — 40f3ae15 biên bản giao hàng photo', () => {
  it('uploads through /upload with type DELIVERY_NOTE and refreshes via onSaved', async () => {
    const { onSaved } = renderCard({ deliveryNotePhotoKey: null });
    uploadMock.mockResolvedValueOnce({ ok: true, storageKey: 'k', url: '/api/photos/k' } as never);

    const input = screen.getByText('Chụp / chọn ảnh biên bản')
      .closest('label')!
      .querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['note-bytes'], 'note.jpg', { type: 'image/jpeg' });
    await fireEvent.change(input, { target: { files: [file] } });
    // onChange handler is async — flush it.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    // The mock accumulates calls from the OCR tests above — pick the /upload one.
    const uploadCall = uploadMock.mock.calls.find(([path]) => path === '/upload');
    expect(uploadCall).toBeTruthy();
    const [, formData] = uploadCall!;
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get('type')).toBe('DELIVERY_NOTE');
    expect((formData as FormData).get('trip_id')).toBe('55');
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('renders the thumbnail with a remove action when a biên bản photo exists', async () => {
    renderCard({ deliveryNotePhotoKey: 'trips/55/other-note.jpg' });

    const img = await screen.findByAltText('Ảnh biên bản giao hàng');
    expect(img.getAttribute('src')).toContain(encodeURIComponent('trips/55/other-note.jpg'));
    expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản' })).toBeTruthy();
  });
});

// QA-003: all three photo types live in ONE card — equal slots, one capture
// row (form), ghost retake row (saved bento) — and the standalone big-button
// biên bản section is gone. QA-008: the hero shows one canonical container
// type, not name · raw-code side by side.
describe('DriverContainerCard — unified photo block', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saved bento shows three equal slots, ghost retake row and tile delete — no standalone biên bản section', async () => {
    // BentoThumb HEAD-preflights the authenticated photo URL before rendering
    // an <img> — satisfy the preflight so tiles render as images, not placeholders.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    renderCard({
      containers: [declaredContainer('MSKU1234567')],
      contPhotoKey: 'trips/55/cont.jpg',
      sealPhotoKey: 'trips/55/seal.jpg',
      deliveryNotePhotoKey: 'trips/55/note.jpg',
    });

    expect(await screen.findByAltText('Ảnh cont')).toBeTruthy();
    expect(screen.getByAltText('Ảnh seal')).toBeTruthy();
    expect(screen.getByAltText('Ảnh biên bản')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản' })).toBeTruthy();
    expect(screen.getByText('Chụp / chọn ảnh biên bản')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mở camera biên bản' })).toBeTruthy();

    expect(screen.queryByText('Biên bản giao hàng')).toBeNull();
    expect(document.querySelector('.dcc-note')).toBeNull();
    expect(screen.queryByText(/tùy chọn/)).toBeNull();
  });

  it('renders one canonical container-type value on the hero (no raw-code duplicate)', () => {
    renderCard({ containers: [declaredContainer('MSKU1234567')] });

    const meta = document.querySelector('.dcc-bento__hero-meta');
    expect(meta?.textContent).toBe("40'HC");
    expect(meta?.textContent).not.toContain('40HC');
  });
});

// QA-018: populated slots open the shared fullscreen PhotoViewer (the e-POD
// pattern) through a named button; empty slots stay inert; Escape closes and
// returns focus to the opener tile; opening/closing never mutates the tiles.
describe('DriverContainerCard — full-image viewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the viewer on a populated tile and returns focus to it on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    renderCard({
      containers: [declaredContainer('MSKU1234567')],
      contPhotoKey: 'trips/55/cont.jpg',
      sealPhotoKey: 'trips/55/seal.jpg',
      deliveryNotePhotoKey: 'trips/55/note.jpg',
    });

    const opener = await screen.findByRole('button', { name: 'Xem ảnh biên bản' });
    fireEvent.click(opener);

    expect(document.querySelector('.pv-overlay')).toBeTruthy();
    // Gallery starts on the clicked slot (3rd of 3 populated).
    expect(document.querySelector('.pv-counter')?.textContent).toBe('3 / 3');
    // Opening never removes the compact tile underneath.
    expect(screen.getByAltText('Ảnh biên bản')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.pv-overlay')).toBeNull());
    expect(document.activeElement).toBe(opener);
    // Closing never changed or removed the attachment.
    expect(screen.getByAltText('Ảnh biên bản')).toBeTruthy();
  });

  it('empty slots expose no viewer action', () => {
    renderCard({ containers: [declaredContainer('MSKU1234567')] });

    expect(screen.queryByRole('button', { name: 'Xem ảnh cont' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xem ảnh seal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xem ảnh biên bản' })).toBeNull();
  });
});
