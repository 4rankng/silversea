import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
